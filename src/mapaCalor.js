/* =========================================================
   Mapa de calor — cálculo en el servidor con SQL
   Cuenta los tickets de cada combinación Edificio × Categoría
   o Edificio × Nivel directamente en la base de datos.
   ========================================================= */
'use strict';
const { conexion, fecha } = require('./db');
const { ErrorHttp } = require('./auth');

const VISTAS = ['categoria', 'nivel'];
const PERIODOS = { '7': 7, '30': 30, '90': 90, todo: null };
const SEVERIDADES = ['Baja', 'Media', 'Crítica'];
const ESTADOS = { todos: null, activos: ['Abierto', 'Asignado', 'En Proceso'], cerrados: ['Resuelto', 'Cerrado'] };

/* Valida los parámetros que llegan en la URL (?vista=&dias=&severidad=&estado=) */
function leerFiltros(q = {}) {
  const vista = q.vista || 'categoria';
  if (!VISTAS.includes(vista)) throw new ErrorHttp(400, `Parámetro "vista" inválido: usa ${VISTAS.join(' o ')}.`);
  const dias = String(q.dias || 'todo');
  if (!(dias in PERIODOS)) throw new ErrorHttp(400, 'Parámetro "dias" inválido: usa 7, 30, 90 o todo.');
  const severidad = q.severidad || '';
  if (severidad && !SEVERIDADES.includes(severidad)) throw new ErrorHttp(400, 'Parámetro "severidad" inválido: usa Baja, Media o Crítica.');
  const estado = q.estado || 'todos';
  if (!(estado in ESTADOS)) throw new ErrorHttp(400, 'Parámetro "estado" inválido: usa todos, activos o cerrados.');
  return { vista, dias, severidad, estado };
}

function condiciones(f) {
  const where = [];
  const params = [];
  if (PERIODOS[f.dias]) { where.push("t.creado_en >= datetime('now', 'localtime', ?)"); params.push(`-${PERIODOS[f.dias]} days`); }
  if (f.severidad) { where.push('t.severidad = ?'); params.push(f.severidad); }
  if (ESTADOS[f.estado]) { where.push(`t.estado IN (${ESTADOS[f.estado].map(() => '?').join(',')})`); params.push(...ESTADOS[f.estado]); }
  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

const JOINS = `FROM tickets t
  JOIN espacios e    ON e.id = t.espacio_id
  JOIN niveles n     ON n.id = e.nivel_id
  JOIN edificios ed  ON ed.id = n.edificio_id
  JOIN categorias c  ON c.id = t.categoria_id`;

function umbral() {
  const r = conexion().prepare("SELECT valor FROM configuracion WHERE clave = 'mapa_umbral_zona_caliente'").get();
  return Math.max(1, Number(r?.valor) || 3);
}

/* Calcula la matriz completa del mapa de calor */
function calcular(filtros) {
  const f = leerFiltros(filtros);
  const db = conexion();
  const inicio = process.hrtime.bigint();
  const { sql: where, params } = condiciones(f);

  const edificios = db.prepare('SELECT id, nombre FROM edificios ORDER BY id').all();
  let columnas;
  let consulta;
  if (f.vista === 'categoria') {
    columnas = db.prepare('SELECT nombre AS id, nombre, icono FROM categorias ORDER BY categorias.id').all();
    consulta = `SELECT ed.id AS fila, c.nombre AS columna, COUNT(*) AS total\n${JOINS}\n${where}\nGROUP BY ed.id, c.nombre`;
  } else {
    columnas = db.prepare("SELECT clave AS id, MIN(nombre) AS nombre FROM niveles GROUP BY clave ORDER BY CASE clave WHEN 'PB' THEN 0 ELSE 1 END, clave").all();
    consulta = `SELECT ed.id AS fila, n.clave AS columna, COUNT(*) AS total\n${JOINS}\n${where}\nGROUP BY ed.id, n.clave`;
  }
  const conteos = db.prepare(consulta).all(...params);
  const nivelesPorEdificio = f.vista === 'nivel' ? db.prepare('SELECT edificio_id, clave FROM niveles').all() : [];

  const celdas = {};
  for (const ed of edificios) {
    celdas[ed.id] = {};
    for (const col of columnas) {
      const existe = f.vista === 'categoria' || nivelesPorEdificio.some(nv => nv.edificio_id === ed.id && nv.clave === col.id);
      celdas[ed.id][col.id] = existe ? 0 : null;
    }
  }
  for (const r of conteos) if (celdas[r.fila] && r.columna in celdas[r.fila]) celdas[r.fila][r.columna] = r.total;

  const u = umbral();
  let max = 0;
  let total = 0;
  let zonaMax = null;
  const calientes = [];
  const filas = edificios.map(ed => {
    let suma = 0;
    for (const col of columnas) {
      const v = celdas[ed.id][col.id];
      if (v == null) continue;
      suma += v;
      if (v > max) { max = v; zonaMax = { fila: ed.id, columna: col.id, reportes: v }; }
      if (v >= u) calientes.push({ fila: ed.id, columna: col.id, reportes: v });
    }
    total += suma;
    return { id: ed.id, nombre: ed.nombre, corto: ed.nombre.split(' · ')[1] || ed.nombre, total: suma };
  });
  const cols = columnas.map(c => ({ ...c, total: edificios.reduce((a, ed) => a + (celdas[ed.id][c.id] || 0), 0) }));
  calientes.sort((a, b) => b.reportes - a.reportes);

  return {
    ...f,
    filas, columnas: cols, celdas, max, total, umbral: u, calientes, zonaMax,
    generado: Date.now(),
    ms: Math.round(Number(process.hrtime.bigint() - inicio) / 1e4) / 100,
    sql: consulta.replace(/\?/g, () => JSON.stringify(params.shift?.() ?? '?'))
  };
}

/* Tickets que forman una celda del mapa */
function detalle(q) {
  const f = leerFiltros(q);
  if (!q.fila || !q.columna) throw new ErrorHttp(400, 'Faltan los parámetros "fila" (edificio) y "columna".');
  const { sql: where, params } = condiciones(f);
  const extra = f.vista === 'categoria' ? 'c.nombre = ?' : 'n.clave = ?';
  const filtro = `${where ? where + ' AND' : 'WHERE'} ed.id = ? AND ${extra}`;
  return conexion().prepare(`
    SELECT t.folio, t.estado, t.severidad, t.activo, t.descripcion, t.creado_en, e.nombre AS espacio,
           n.nombre AS nivel, c.nombre AS categoria, s.nombre AS solicitante, tec.nombre AS tecnico
    ${JOINS}
    JOIN usuarios s ON s.id = t.solicitante_id
    LEFT JOIN usuarios tec ON tec.id = t.tecnico_id
    ${filtro}
    ORDER BY t.creado_en DESC`).all(...params, q.fila, q.columna);
}

/* Después de cada reporte nuevo: ¿la zona se volvió "caliente"? */
function revisarZona(ticketId) {
  const db = conexion();
  const t = db.prepare(`SELECT t.id, t.folio, ed.id AS edificio, ed.nombre AS edificio_nombre, c.nombre AS categoria
    ${JOINS} WHERE t.id = ?`).get(ticketId);
  if (!t) return null;
  const dias = Number(db.prepare("SELECT valor FROM configuracion WHERE clave = 'mapa_dias_alerta'").get()?.valor) || 30;
  const u = umbral();
  const { n } = db.prepare(`SELECT COUNT(*) AS n ${JOINS}
    WHERE ed.id = ? AND c.nombre = ? AND t.creado_en >= datetime('now', 'localtime', ?)`).get(t.edificio, t.categoria, `-${dias} days`);
  if (n < u) return null;
  const reciente = db.prepare(`SELECT 1 FROM mapa_calor_alertas WHERE edificio_id = ? AND categoria = ?
    AND creado_en >= datetime('now', 'localtime', '-1 day')`).get(t.edificio, t.categoria);
  if (reciente) return null;
  db.prepare('INSERT INTO mapa_calor_alertas (edificio_id, categoria, reportes, umbral, ticket_id, creado_en) VALUES (?, ?, ?, ?, ?, ?)')
    .run(t.edificio, t.categoria, n, u, t.id, fecha());
  return { ...t, reportes: n, umbral: u, dias };
}

module.exports = { leerFiltros, calcular, detalle, revisarZona, umbral };
