/* =========================================================
   /api/notificaciones — avisos del usuario (RF-05)
   ========================================================= */
'use strict';
const express = require('express');
const { conexion, aMs } = require('../src/db');
const { ErrorHttp } = require('../src/auth');

const router = express.Router();

/* GET /api/notificaciones */
router.get('/', (req, res) => {
  const filas = conexion().prepare(`
    SELECT n.*, t.folio FROM notificaciones n
    LEFT JOIN tickets t ON t.id = n.ticket_id
    WHERE n.usuario_id = ? ORDER BY n.creada_en DESC, n.id DESC LIMIT 250`).all(req.usuario.id);
  res.json(filas.map(n => ({
    id: String(n.id), to: req.usuario.correo, title: n.titulo, body: n.mensaje,
    ticketId: n.folio, at: aMs(n.creada_en), read: !!n.leida
  })));
});

/* PATCH /api/notificaciones/:id/leida */
router.patch('/:id/leida', (req, res) => {
  const r = conexion().prepare('UPDATE notificaciones SET leida = 1 WHERE id = ? AND usuario_id = ?').run(req.params.id, req.usuario.id);
  if (!r.changes) throw new ErrorHttp(404, 'La notificación no existe.');
  res.json({ ok: true });
});

/* POST /api/notificaciones/leer-todas */
router.post('/leer-todas', (req, res) => {
  const r = conexion().prepare('UPDATE notificaciones SET leida = 1 WHERE usuario_id = ? AND leida = 0').run(req.usuario.id);
  res.json({ actualizadas: Number(r.changes) });
});

/* DELETE /api/notificaciones/:id */
router.delete('/:id', (req, res) => {
  const r = conexion().prepare('DELETE FROM notificaciones WHERE id = ? AND usuario_id = ?').run(req.params.id, req.usuario.id);
  if (!r.changes) throw new ErrorHttp(404, 'La notificación no existe.');
  res.json({ ok: true });
});

/* DELETE /api/notificaciones — borrar todas las del usuario */
router.delete('/', (req, res) => {
  const r = conexion().prepare('DELETE FROM notificaciones WHERE usuario_id = ?').run(req.usuario.id);
  res.json({ eliminadas: Number(r.changes) });
});

module.exports = router;
