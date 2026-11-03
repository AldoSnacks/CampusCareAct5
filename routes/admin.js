/* =========================================================
   /api/admin — explorador de la base de datos (solo admin)
   Permite ver, agregar, editar y eliminar registros de
   cualquier tabla, consultar con SQL y descargar un respaldo.
   ========================================================= */
'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { conexion, recrearEsquema, ident, DB_PATH } = require('../src/db');
const { ErrorHttp } = require('../src/auth');
const { sembrar } = require('../src/seed');
const { vaciarCarpeta } = require('../src/fotos');
const { emitir } = require('../src/eventos');
const cache = require('../src/cache');

const router = express.Router();
const POR_PAGINA = 25;

const DESCRIPCIONES = {
  usuarios: 'Cuentas institucionales, rol y contraseña cifrada (bcrypt).',
  edificios: 'Catálogo de edificios del campus.',
  niveles: 'Niveles o pisos de cada edificio.',
  espacios: 'Aulas, laboratorios y áreas de cada nivel.',
  categorias: 'Tipos de falla que se pueden reportar.',
  severidades: 'Niveles de severidad y su tiempo máximo de atención (SLA).',
  tickets: 'Incidencias levantadas por la comunidad.',
  resoluciones: 'Evidencia del trabajo concluido por el técnico.',
  historial_estados: 'Trazabilidad de cada cambio de estado.',
  notificaciones: 'Avisos enviados a cada usuario.',
  accesos: 'Bitácora de inicios de sesión y registros de cuenta.',
  vista_reporte_tickets: 'Vista de solo lectura que une tickets con su ubicación, técnico y cumplimiento de SLA.'
};
const ORDEN = Object.keys(DESCRIPCIONES);

/* Solo se permiten tablas y vistas que existen en la base */
function objeto(nombre) {
  const o = conexion().prepare("SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','view') AND name = ? AND name NOT LIKE 'sqlite_%'").get(nombre);
  if (!o) throw new ErrorHttp(404, `La tabla "${nombre}" no existe.`);
  return o;
}

function columnas(tabla) {
  const db = conexion();
  const info = db.prepare(`PRAGMA table_info(${ident(tabla)})`).all();
  const fks = db.prepare(`PRAGMA foreign_key_list(${ident(tabla)})`).all();
  return info.map(c => {
    const fk = fks.find(f => f.from === c.name);
    return {
      nombre: c.name,
      tipo: c.type || 'TEXT',
      requerido: !!c.notnull && c.dflt_value == null && !c.pk,
      pk: !!c.pk,
      defecto: c.dflt_value,
      autoincremento: !!c.pk && /INTEGER/i.test(c.type),
      fk: fk ? { tabla: fk.table, columna: fk.to || 'id', alBorrar: fk.on_delete } : null
    };
  });
}

function llavePrimaria(cols) {
  return cols.find(c => c.pk)?.nombre || 'rowid';
}

/* Convierte lo que llega del formulario al tipo de la columna */
function convertir(valor, col) {
  if (valor === undefined) return undefined;
  if (valor === null || valor === '') return null;
  if (typeof valor === 'boolean') return valor ? 1 : 0;
  if (/INT|REAL|NUM/i.test(col.tipo) && /^-?\d+(\.\d+)?$/.test(String(valor).trim())) return Number(valor);
  return String(valor);
}

function prepararValores(tabla, cols, valores, esNuevo) {
  const salida = {};
  for (const c of cols) {
    if (!(c.nombre in valores)) continue;
    if (c.pk && !esNuevo) continue;
    let v = convertir(valores[c.nombre], c);
    if (v === null && esNuevo && c.autoincremento) continue;
    if (v === null && esNuevo && c.defecto != null) continue;
    if (tabla === 'usuarios' && c.nombre === 'password_hash' && v && !String(v).startsWith('$2')) {
      v = bcrypt.hashSync(String(v), 10); // si se escribe una contraseña en texto plano, se cifra
    }
    salida[c.nombre] = v;
  }
  return salida;
}

/* GET /api/admin/tablas — lista de tablas con su número de registros */
router.get('/tablas', (req, res) => {
  const db = conexion();
  const objetos = db.prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'").all();
  const lista = objetos.map(o => ({
    nombre: o.name,
    tipo: o.type === 'view' ? 'vista' : 'tabla',
    descripcion: DESCRIPCIONES[o.name] || '',
    registros: db.prepare(`SELECT COUNT(*) AS n FROM ${ident(o.name)}`).get().n
  }));
  lista.sort((a, b) => (ORDEN.indexOf(a.nombre) + 1 || 99) - (ORDEN.indexOf(b.nombre) + 1 || 99));
  res.json(lista);
});

/* GET /api/admin/tablas/:tabla?pagina=1&buscar=texto */
router.get('/tablas/:tabla', (req, res) => {
  const db = conexion();
  const o = objeto(req.params.tabla);
  const cols = columnas(o.name);
  const pk = llavePrimaria(cols);
  const pagina = Math.max(1, Number(req.query.pagina) || 1);
  const buscar = String(req.query.buscar || '').trim();

  let where = '';
  const params = [];
  if (buscar) {
    where = 'WHERE ' + cols.map(c => `CAST(${ident(c.nombre)} AS TEXT) LIKE ?`).join(' OR ');
    cols.forEach(() => params.push(`%${buscar}%`));
  }
  const total = db.prepare(`SELECT COUNT(*) AS n FROM ${ident(o.name)} ${where}`).get(...params).n;
  const orden = o.type === 'view' ? '' : `ORDER BY ${pk === 'rowid' ? 'rowid' : ident(pk)} DESC`;
  const filas = db.prepare(`SELECT * FROM ${ident(o.name)} ${where} ${orden} LIMIT ? OFFSET ?`)
    .all(...params, POR_PAGINA, (pagina - 1) * POR_PAGINA);

  res.json({
    nombre: o.name,
    tipo: o.type === 'view' ? 'vista' : 'tabla',
    descripcion: DESCRIPCIONES[o.name] || '',
    sql: o.sql,
    columnas: cols,
    pk,
    filas,
    total,
    pagina,
    porPagina: POR_PAGINA
  });
});

/* GET /api/admin/tablas/:tabla/opciones — valores posibles para las llaves foráneas */
router.get('/tablas/:tabla/opciones', (req, res) => {
  const db = conexion();
  const o = objeto(req.params.tabla);
  const opciones = {};
  for (const c of columnas(o.name).filter(x => x.fk)) {
    const destino = c.fk.tabla;
    const colsDestino = db.prepare(`PRAGMA table_info(${ident(destino)})`).all().map(x => x.name);
    const etiqueta = ['folio', 'nombre', 'correo', 'titulo'].filter(x => colsDestino.includes(x));
    const extra = destino === 'niveles' ? ", edificio_id || ' · ' || nombre" : etiqueta.length ? `, ${etiqueta.map(ident).join(" || ' · ' || ")}` : '';
    opciones[c.nombre] = db.prepare(`SELECT ${ident(c.fk.columna)} AS valor ${extra ? extra + ' AS etiqueta' : ''} FROM ${ident(destino)} ORDER BY 1 LIMIT 500`).all()
      .map(r => ({ valor: r.valor, etiqueta: r.etiqueta ? `${r.valor} — ${r.etiqueta}` : String(r.valor) }));
  }
  res.json(opciones);
});

/* POST /api/admin/tablas/:tabla — insertar registro */
router.post('/tablas/:tabla', (req, res) => {
  const o = objeto(req.params.tabla);
  if (o.type === 'view') throw new ErrorHttp(400, 'Las vistas son de solo lectura.');
  const cols = columnas(o.name);
  const valores = prepararValores(o.name, cols, req.body.valores || {}, true);
  const nombres = Object.keys(valores);
  if (!nombres.length) throw new ErrorHttp(400, 'Captura al menos un campo.');
  const r = conexion().prepare(`INSERT INTO ${ident(o.name)} (${nombres.map(ident).join(', ')}) VALUES (${nombres.map(() => '?').join(', ')})`)
    .run(...nombres.map(n => valores[n]));
  emitir('base-de-datos');
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

/* PUT /api/admin/tablas/:tabla/:id — editar registro */
router.put('/tablas/:tabla/:id', (req, res) => {
  const o = objeto(req.params.tabla);
  if (o.type === 'view') throw new ErrorHttp(400, 'Las vistas son de solo lectura.');
  const cols = columnas(o.name);
  const pk = llavePrimaria(cols);
  const valores = prepararValores(o.name, cols, req.body.valores || {}, false);
  const nombres = Object.keys(valores);
  if (!nombres.length) throw new ErrorHttp(400, 'No hay cambios que guardar.');
  const r = conexion().prepare(`UPDATE ${ident(o.name)} SET ${nombres.map(n => `${ident(n)} = ?`).join(', ')} WHERE ${pk === 'rowid' ? 'rowid' : ident(pk)} = ?`)
    .run(...nombres.map(n => valores[n]), req.params.id);
  if (!r.changes) throw new ErrorHttp(404, 'El registro no existe.');
  emitir('base-de-datos');
  res.json({ ok: true });
});

/* DELETE /api/admin/tablas/:tabla/:id — eliminar registro */
router.delete('/tablas/:tabla/:id', (req, res) => {
  const o = objeto(req.params.tabla);
  if (o.type === 'view') throw new ErrorHttp(400, 'Las vistas son de solo lectura.');
  const pk = llavePrimaria(columnas(o.name));
  if (o.name === 'usuarios' && Number(req.params.id) === req.usuario.id) throw new ErrorHttp(400, 'No puedes eliminar tu propia cuenta.');
  const r = conexion().prepare(`DELETE FROM ${ident(o.name)} WHERE ${pk === 'rowid' ? 'rowid' : ident(pk)} = ?`).run(req.params.id);
  if (!r.changes) throw new ErrorHttp(404, 'El registro no existe.');
  emitir('base-de-datos');
  res.json({ ok: true, eliminados: Number(r.changes) });
});

/* POST /api/admin/consulta  { sql } — consola SQL de solo lectura */
router.post('/consulta', (req, res) => {
  const sql = String(req.body.sql || '').trim().replace(/;+\s*$/, '');
  if (!sql) throw new ErrorHttp(400, 'Escribe una consulta.');
  if (!/^(select|with|pragma)\b/i.test(sql)) throw new ErrorHttp(400, 'La consola solo permite consultas de lectura (SELECT). Para agregar, editar o eliminar usa los botones de cada tabla.');
  if (sql.includes(';')) throw new ErrorHttp(400, 'Ejecuta una sola consulta a la vez.');
  if (/^pragma/i.test(sql) && sql.includes('=')) throw new ErrorHttp(400, 'No se permite modificar la configuración de la base.');

  const db = conexion();
  const inicio = process.hrtime.bigint();
  let filas;
  db.exec('BEGIN');
  try {
    filas = db.prepare(sql).all(); // dentro de una transacción que siempre se revierte
  } finally {
    db.exec('ROLLBACK');
  }
  const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
  res.json({
    columnas: filas.length ? Object.keys(filas[0]) : [],
    filas: filas.slice(0, 500),
    total: filas.length,
    truncado: filas.length > 500,
    ms: Math.round(ms * 100) / 100
  });
});

/* GET /api/admin/respaldo — descarga el archivo .db */
router.get('/respaldo', (req, res) => {
  const d = new Date();
  const nombre = `campuscare-respaldo-${d.toISOString().slice(0, 10)}.db`;
  res.download(DB_PATH, nombre);
});

/* GET /api/admin/cache — estado de la caché del servidor */
router.get('/cache', (req, res) => {
  res.json(cache.estado());
});

/* DELETE /api/admin/cache — vaciar la caché del servidor */
router.delete('/cache', (req, res) => {
  cache.reiniciar();
  res.json({ ok: true });
});

/* POST /api/admin/reset — borra todo y vuelve a cargar los datos de demostración */
router.post('/reset', (req, res) => {
  recrearEsquema();
  sembrar();
  vaciarCarpeta();
  emitir('reset');
  res.json({ ok: true });
});

module.exports = router;
