/* =========================================================
   /api/catalogo — edificios, niveles, espacios, categorías
   y severidades. Lectura para todos; cambios solo admin.
   ========================================================= */
'use strict';
const express = require('express');
const { conexion } = require('../src/db');
const { requiereRol, ErrorHttp } = require('../src/auth');
const { emitir } = require('../src/eventos');
const cache = require('../src/cache');

const router = express.Router();
const soloAdmin = requiereRol('admin');
const ICONOS = ['zap', 'chair', 'wifi', 'drop', 'building', 'box', 'wrench', 'shield', 'layers', 'door', 'alert', 'info'];

const texto = (v, campo, max = 80) => {
  const t = String(v ?? '').trim().replace(/\s+/g, ' ');
  if (!t) throw new ErrorHttp(400, `El campo "${campo}" es obligatorio.`);
  if (t.length > max) throw new ErrorHttp(400, `El campo "${campo}" admite máximo ${max} caracteres.`);
  return t;
};
const opcional = v => (String(v ?? '').trim() || null);
const listo = (res, motivo, extra = {}) => { emitir(motivo); res.json({ ok: true, ...extra }); };

/* GET /api/catalogo — todo lo necesario para los formularios */
router.get('/', (req, res) => {
  const { valor, hit } = cache.obtener('catalogo', 300, leerCatalogo);
  res.setHeader('X-Cache', hit ? 'HIT' : 'MISS');
  res.setHeader('Cache-Control', 'private, no-cache'); // el navegador revalida con ETag (respuesta 304)
  res.json(valor);
});

function leerCatalogo() {
  const db = conexion();
  const edificios = db.prepare(`
    SELECT e.*, (SELECT COUNT(*) FROM tickets t JOIN espacios es ON es.id = t.espacio_id JOIN niveles n ON n.id = es.nivel_id
                 WHERE n.edificio_id = e.id AND t.estado IN ('Abierto','Asignado','En Proceso')) AS activos
    FROM edificios e ORDER BY e.id`).all();
  const niveles = db.prepare('SELECT * FROM niveles ORDER BY edificio_id, id').all();
  const espacios = db.prepare(`
    SELECT es.*, (SELECT COUNT(*) FROM tickets t WHERE t.espacio_id = es.id) AS tickets
    FROM espacios es ORDER BY es.nivel_id, es.id`).all();
  const categorias = db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM tickets t WHERE t.categoria_id = c.id) AS tickets
    FROM categorias c ORDER BY c.id`).all();
  const severidades = db.prepare('SELECT * FROM severidades ORDER BY orden').all();
  const personal = db.prepare("SELECT correo, nombre, rol, avatar FROM usuarios WHERE rol IN ('mantenimiento','admin') AND activo = 1 ORDER BY rol, nombre").all();

  return {
    edificios: edificios.map(e => ({
      id: e.id, nombre: e.nombre, img: e.imagen, activos: e.activos,
      niveles: niveles.filter(n => n.edificio_id === e.id).map(n => {
        const lista = espacios.filter(es => es.nivel_id === n.id);
        return { id: n.clave, dbId: n.id, nombre: n.nombre, espacios: lista.map(es => es.nombre), espaciosDet: lista.map(es => ({ id: es.id, nombre: es.nombre, tickets: es.tickets })) };
      })
    })),
    categorias: categorias.map(c => ({ id: c.id, nombre: c.nombre, desc: c.descripcion, icono: c.icono, img: c.imagen, tickets: c.tickets })),
    severidades: severidades.map(s => ({ nombre: s.nombre, sla: s.sla_horas, desc: s.descripcion })),
    personal
  };
}

/* ---------- Edificios ---------- */
router.post('/edificios', soloAdmin, (req, res) => {
  const id = texto(req.body.id, 'Clave', 5).toUpperCase();
  if (!/^[A-Z0-9]+$/.test(id)) throw new ErrorHttp(400, 'La clave del edificio solo admite letras y números (ej. E o LAB2).');
  conexion().prepare('INSERT INTO edificios (id, nombre, imagen) VALUES (?, ?, ?)').run(id, texto(req.body.nombre, 'Nombre'), opcional(req.body.imagen));
  listo(res, 'catalogo');
});

router.put('/edificios/:id', soloAdmin, (req, res) => {
  const r = conexion().prepare('UPDATE edificios SET nombre = ?, imagen = ? WHERE id = ?').run(texto(req.body.nombre, 'Nombre'), opcional(req.body.imagen), req.params.id);
  if (!r.changes) throw new ErrorHttp(404, 'El edificio no existe.');
  listo(res, 'catalogo');
});

router.delete('/edificios/:id', soloAdmin, (req, res) => {
  const r = conexion().prepare('DELETE FROM edificios WHERE id = ?').run(req.params.id);
  if (!r.changes) throw new ErrorHttp(404, 'El edificio no existe.');
  listo(res, 'catalogo');
});

/* ---------- Niveles ---------- */
router.post('/niveles', soloAdmin, (req, res) => {
  const clave = texto(req.body.clave, 'Clave', 6).toUpperCase();
  conexion().prepare('INSERT INTO niveles (edificio_id, clave, nombre) VALUES (?, ?, ?)').run(texto(req.body.edificio_id, 'Edificio', 5), clave, texto(req.body.nombre, 'Nombre'));
  listo(res, 'catalogo');
});

router.delete('/niveles/:id', soloAdmin, (req, res) => {
  const r = conexion().prepare('DELETE FROM niveles WHERE id = ?').run(req.params.id);
  if (!r.changes) throw new ErrorHttp(404, 'El nivel no existe.');
  listo(res, 'catalogo');
});

/* ---------- Espacios ---------- */
router.post('/espacios', soloAdmin, (req, res) => {
  conexion().prepare('INSERT INTO espacios (nivel_id, nombre) VALUES (?, ?)').run(Number(req.body.nivel_id), texto(req.body.nombre, 'Nombre del espacio'));
  listo(res, 'catalogo');
});

router.delete('/espacios/:id', soloAdmin, (req, res) => {
  const r = conexion().prepare('DELETE FROM espacios WHERE id = ?').run(req.params.id);
  if (!r.changes) throw new ErrorHttp(404, 'El espacio no existe.');
  listo(res, 'catalogo');
});

/* ---------- Categorías ---------- */
router.post('/categorias', soloAdmin, (req, res) => {
  const icono = ICONOS.includes(req.body.icono) ? req.body.icono : 'box';
  conexion().prepare('INSERT INTO categorias (nombre, descripcion, icono, imagen) VALUES (?, ?, ?, ?)')
    .run(texto(req.body.nombre, 'Nombre', 40), opcional(req.body.descripcion), icono, opcional(req.body.imagen));
  listo(res, 'catalogo');
});

router.put('/categorias/:id', soloAdmin, (req, res) => {
  const icono = ICONOS.includes(req.body.icono) ? req.body.icono : 'box';
  const r = conexion().prepare('UPDATE categorias SET nombre = ?, descripcion = ?, icono = ?, imagen = ? WHERE id = ?')
    .run(texto(req.body.nombre, 'Nombre', 40), opcional(req.body.descripcion), icono, opcional(req.body.imagen), req.params.id);
  if (!r.changes) throw new ErrorHttp(404, 'La categoría no existe.');
  listo(res, 'catalogo');
});

router.delete('/categorias/:id', soloAdmin, (req, res) => {
  const r = conexion().prepare('DELETE FROM categorias WHERE id = ?').run(req.params.id);
  if (!r.changes) throw new ErrorHttp(404, 'La categoría no existe.');
  listo(res, 'catalogo');
});

/* ---------- Severidades (solo se edita el SLA) ---------- */
router.put('/severidades/:nombre', soloAdmin, (req, res) => {
  const sla = Number(req.body.sla_horas);
  if (!Number.isInteger(sla) || sla < 1 || sla > 720) throw new ErrorHttp(400, 'El SLA debe ser un número entero de horas entre 1 y 720.');
  const r = conexion().prepare('UPDATE severidades SET sla_horas = ?, descripcion = COALESCE(?, descripcion) WHERE nombre = ?')
    .run(sla, opcional(req.body.descripcion), req.params.nombre);
  if (!r.changes) throw new ErrorHttp(404, 'La severidad no existe.');
  listo(res, 'catalogo');
});

module.exports = router;
module.exports.ICONOS = ICONOS;
