/* =========================================================
   Lógica de negocio de los tickets
   RF-02 alta · RF-03 máquina de estados · RF-04 evidencia
   ========================================================= */
'use strict';
const { conexion, transaccion, fecha, aMs } = require('./db');
const { ErrorHttp } = require('./auth');
const { guardarFoto, borrarFotos } = require('./fotos');
const { mensajeEstado } = require('./seed');
const push = require('./push');

/* Transiciones permitidas y rol que puede ejecutarlas */
const TRANSICIONES = {
  'Abierto':    ['Asignado', 'Rechazado'],
  'Asignado':   ['En Proceso', 'Rechazado'],
  'En Proceso': ['Resuelto'],
  'Resuelto':   ['Cerrado'],
  'Cerrado':    [],
  'Rechazado':  []
};
const PERMISOS = {
  'Asignado':   ['admin'],
  'Rechazado':  ['admin'],
  'En Proceso': ['mantenimiento'],
  'Resuelto':   ['mantenimiento'],
  'Cerrado':    ['admin', 'solicitante']
};

const SQL_BASE = `
  SELECT t.*, s.correo AS sol_correo, s.nombre AS sol_nombre,
         tec.correo AS tec_correo, tec.nombre AS tec_nombre,
         e.nombre AS espacio_nombre, n.clave AS nivel_clave, n.edificio_id AS edificio,
         c.nombre AS categoria
  FROM tickets t
  LEFT JOIN usuarios s    ON s.id = t.solicitante_id
  LEFT JOIN usuarios tec  ON tec.id = t.tecnico_id
  LEFT JOIN espacios e    ON e.id = t.espacio_id
  LEFT JOIN niveles n     ON n.id = e.nivel_id
  LEFT JOIN categorias c  ON c.id = t.categoria_id`;

/* Convierte las filas de la base al formato que usa el frontend */
function mapear(filas) {
  if (!filas.length) return [];
  const db = conexion();
  const ids = filas.map(f => f.id);
  const marcas = ids.map(() => '?').join(',');
  const historial = db.prepare(`
    SELECT h.*, u.correo AS usuario_correo FROM historial_estados h
    LEFT JOIN usuarios u ON u.id = h.usuario_id
    WHERE h.ticket_id IN (${marcas}) ORDER BY h.fecha, h.id`).all(...ids);
  const resoluciones = db.prepare(`SELECT * FROM resoluciones WHERE ticket_id IN (${marcas})`).all(...ids);

  return filas.map(t => {
    const r = resoluciones.find(x => x.ticket_id === t.id);
    return {
      id: t.folio,
      dbId: t.id,
      createdAt: aMs(t.creado_en),
      updatedAt: aMs(t.actualizado_en),
      solicitante: { email: t.sol_correo, name: t.sol_nombre || 'Usuario eliminado' },
      ubicacion: { edificio: t.edificio, nivel: t.nivel_clave, espacio: t.espacio_nombre, activo: t.activo },
      categoria: t.categoria,
      severidad: t.severidad,
      descripcion: t.descripcion,
      foto: t.foto,
      estado: t.estado,
      tecnico: t.tec_correo || null,
      tecnicoNombre: t.tec_nombre || null,
      rechazo: t.motivo_rechazo,
      resolucion: r ? { foto: r.foto, notas: r.notas, materiales: r.materiales, at: aMs(r.resuelto_en) } : null,
      historial: historial.filter(h => h.ticket_id === t.id).map(h => ({
        de: h.estado_anterior, a: h.estado_nuevo, por: h.usuario_correo,
        porNombre: h.usuario_nombre, at: aMs(h.fecha), nota: h.nota
      }))
    };
  });
}

/* Cada rol ve solo lo que le corresponde */
function listar(usuario) {
  const db = conexion();
  let filas;
  if (usuario.rol === 'admin') filas = db.prepare(`${SQL_BASE} ORDER BY t.creado_en DESC`).all();
  else if (usuario.rol === 'mantenimiento') filas = db.prepare(`${SQL_BASE} WHERE t.tecnico_id = ? ORDER BY t.creado_en DESC`).all(usuario.id);
  else filas = db.prepare(`${SQL_BASE} WHERE t.solicitante_id = ? ORDER BY t.creado_en DESC`).all(usuario.id);
  return mapear(filas);
}

function obtener(folio) {
  const fila = conexion().prepare(`${SQL_BASE} WHERE t.folio = ?`).get(folio);
  if (!fila) throw new ErrorHttp(404, 'El ticket no existe.');
  return fila;
}

function notificar(db, usuarioId, ticketId, titulo, mensaje) {
  db.prepare('INSERT INTO notificaciones (usuario_id, ticket_id, titulo, mensaje, creada_en) VALUES (?, ?, ?, ?, ?)')
    .run(usuarioId, ticketId, titulo, mensaje, fecha());
  // Además del aviso dentro de la app, se envía como notificación push (Punto 14)
  push.encolar(usuarioId, titulo, mensaje, { url: '/#notificaciones', etiqueta: `ticket-${ticketId}` });
}

/* ---------------- RF-02: alta de incidencia ---------------- */
function crear(usuario, d) {
  const db = conexion();
  const requeridos = [['edificio', 'el edificio'], ['nivel', 'el nivel'], ['espacio', 'el espacio o aula'], ['activo', 'el activo afectado'], ['categoria', 'la categoría del problema'], ['severidad', 'la severidad']];
  for (const [k, l] of requeridos) if (!d[k]) throw new ErrorHttp(400, `Selecciona ${l}.`);
  if (!d.foto) throw new ErrorHttp(400, 'Captura una fotografía como evidencia de la incidencia.');
  const descripcion = String(d.descripcion || '').trim();
  if (descripcion.length < 10) throw new ErrorHttp(400, 'Describe el problema con al menos 10 caracteres.');
  if (descripcion.length > 500) throw new ErrorHttp(400, 'La descripción no puede superar 500 caracteres.');

  const espacio = db.prepare(`
    SELECT e.id FROM espacios e JOIN niveles n ON n.id = e.nivel_id
    WHERE n.edificio_id = ? AND n.clave = ? AND e.nombre = ?`).get(d.edificio, d.nivel, d.espacio);
  if (!espacio) throw new ErrorHttp(400, 'La ubicación seleccionada ya no existe en el catálogo.');
  const categoria = db.prepare('SELECT id FROM categorias WHERE nombre = ?').get(d.categoria);
  if (!categoria) throw new ErrorHttp(400, 'La categoría seleccionada no existe.');
  const severidad = db.prepare('SELECT nombre FROM severidades WHERE nombre = ?').get(d.severidad);
  if (!severidad) throw new ErrorHttp(400, 'La severidad seleccionada no existe.');

  const foto = guardarFoto(d.foto, 'reporte');
  try {
    return transaccion(() => {
      const ahora = fecha();
      const id = Number(db.prepare(`INSERT INTO tickets
        (solicitante_id, espacio_id, activo, categoria_id, severidad, descripcion, foto, estado, creado_en, actualizado_en)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'Abierto', ?, ?)`)
        .run(usuario.id, espacio.id, String(d.activo).slice(0, 80), categoria.id, severidad.nombre, descripcion, foto, ahora, ahora).lastInsertRowid);
      const { folio } = db.prepare('SELECT folio FROM tickets WHERE id = ?').get(id);
      db.prepare('INSERT INTO historial_estados (ticket_id, estado_anterior, estado_nuevo, usuario_id, usuario_nombre, nota, fecha) VALUES (?, NULL, ?, ?, ?, ?, ?)')
        .run(id, 'Abierto', usuario.id, usuario.nombre, 'Incidencia registrada por el solicitante', ahora);
      const admins = db.prepare("SELECT id FROM usuarios WHERE rol = 'admin' AND activo = 1 AND id <> ?").all(usuario.id);
      for (const a of admins) notificar(db, a.id, id, `Nuevo reporte ${folio}`, `${d.categoria} · ${d.severidad} — Edif. ${d.edificio} · ${d.espacio}`);
      return folio;
    });
  } catch (e) {
    borrarFotos(foto);
    throw e;
  }
}

/* ---------------- RF-03 / RF-04: cambio de estado ---------------- */
function transicion(usuario, folio, d) {
  const db = conexion();
  const t = obtener(folio);
  const destino = d.estado;
  const origen = t.estado;

  if (!TRANSICIONES[origen]?.includes(destino)) throw new ErrorHttp(409, `Transición no permitida: ${origen} → ${destino}.`);
  if (!PERMISOS[destino].includes(usuario.rol)) throw new ErrorHttp(403, 'Tu rol no puede realizar este cambio de estado.');

  let tecnicoId = t.tecnico_id;
  let tecnicoNombre = t.tec_nombre;
  let motivo = null;
  let fotoEvidencia = null;

  if (destino === 'Asignado') {
    const tec = db.prepare("SELECT id, nombre FROM usuarios WHERE correo = ? AND rol = 'mantenimiento' AND activo = 1").get(d.tecnico);
    if (!tec) throw new ErrorHttp(400, 'Selecciona a un técnico activo.');
    tecnicoId = tec.id;
    tecnicoNombre = tec.nombre;
  }
  if (['En Proceso', 'Resuelto'].includes(destino) && t.tecnico_id !== usuario.id) {
    throw new ErrorHttp(403, 'Solo el técnico asignado puede trabajar este ticket.');
  }
  if (destino === 'Resuelto') {
    if (!d.foto) throw new ErrorHttp(400, 'Adjunta al menos una fotografía del trabajo concluido.');
    if (!String(d.notas || '').trim()) throw new ErrorHttp(400, 'Escribe las notas técnicas de la solución.');
    if (!String(d.materiales || '').trim()) throw new ErrorHttp(400, 'Indica los materiales o refacciones utilizados (o escribe "Ninguno").');
  }
  if (destino === 'Rechazado') {
    motivo = String(d.motivo || '').trim();
    if (!motivo) throw new ErrorHttp(400, 'Indica el motivo del rechazo.');
  }
  if (destino === 'Cerrado' && usuario.rol === 'solicitante' && t.solicitante_id !== usuario.id) {
    throw new ErrorHttp(403, 'Solo puedes cerrar tus propios reportes.');
  }

  if (destino === 'Resuelto') fotoEvidencia = guardarFoto(d.foto, 'evidencia');

  const notaPorDefecto = {
    'Asignado': `Asignado a ${tecnicoNombre}`, 'En Proceso': 'Inicio de labores en sitio',
    'Resuelto': 'Trabajo concluido con evidencia', 'Rechazado': motivo, 'Cerrado': 'Ticket cerrado'
  };

  try {
    transaccion(() => {
      const ahora = fecha();
      db.prepare('UPDATE tickets SET estado = ?, tecnico_id = ?, motivo_rechazo = COALESCE(?, motivo_rechazo), actualizado_en = ? WHERE id = ?')
        .run(destino, tecnicoId, motivo, ahora, t.id);
      if (destino === 'Resuelto') {
        db.prepare('INSERT INTO resoluciones (ticket_id, tecnico_id, foto, notas, materiales, resuelto_en) VALUES (?, ?, ?, ?, ?, ?)')
          .run(t.id, usuario.id, fotoEvidencia, String(d.notas).trim(), String(d.materiales).trim(), ahora);
      }
      db.prepare('INSERT INTO historial_estados (ticket_id, estado_anterior, estado_nuevo, usuario_id, usuario_nombre, nota, fecha) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(t.id, origen, destino, usuario.id, usuario.nombre, String(d.nota || '').trim() || notaPorDefecto[destino], ahora);

      // RF-05: avisos a los involucrados
      if (t.solicitante_id !== usuario.id) notificar(db, t.solicitante_id, t.id, `${folio} · ${destino}`, mensajeEstado(destino, tecnicoNombre, motivo));
      if (destino === 'Asignado') notificar(db, tecnicoId, t.id, `Nueva orden ${folio}`, `${t.categoria} · ${t.severidad} — Edif. ${t.edificio} · ${t.espacio_nombre}`);
      if (destino === 'Resuelto') {
        const admins = db.prepare("SELECT id FROM usuarios WHERE rol = 'admin' AND activo = 1").all();
        for (const a of admins) notificar(db, a.id, t.id, `${folio} listo para cierre`, `${usuario.nombre} registró la solución con evidencia.`);
      }
      if (destino === 'Cerrado' && usuario.rol === 'solicitante' && tecnicoId) notificar(db, tecnicoId, t.id, `${folio} · Cerrado`, 'El solicitante confirmó la solución.');
    });
  } catch (e) {
    borrarFotos(fotoEvidencia);
    throw e;
  }
}

/* ---------------- Baja de un ticket ---------------- */
function eliminar(usuario, folio) {
  const db = conexion();
  const t = obtener(folio);
  if (usuario.rol === 'solicitante') {
    if (t.solicitante_id !== usuario.id) throw new ErrorHttp(403, 'Solo puedes cancelar tus propios reportes.');
    if (t.estado !== 'Abierto') throw new ErrorHttp(409, 'Solo puedes cancelar reportes que aún no han sido asignados.');
  } else if (usuario.rol !== 'admin') {
    throw new ErrorHttp(403, 'Tu rol no puede eliminar tickets.');
  }
  const res = db.prepare('SELECT foto FROM resoluciones WHERE ticket_id = ?').get(t.id);
  // ON DELETE CASCADE borra historial, resolución y notificaciones relacionadas
  db.prepare('DELETE FROM tickets WHERE id = ?').run(t.id);
  borrarFotos(t.foto, res?.foto);
}

module.exports = { listar, crear, transicion, eliminar, notificar };
