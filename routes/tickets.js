/* =========================================================
   /api/tickets — incidencias (RF-02, RF-03, RF-04)
   ========================================================= */
'use strict';
const express = require('express');
const tickets = require('../src/tickets');
const { requiereRol } = require('../src/auth');
const { emitir } = require('../src/eventos');
const { conexion } = require('../src/db');
const mapa = require('../src/mapaCalor');

/* Si el nuevo reporte convierte la zona en "zona caliente", se avisa a los administradores */
function alertaZonaCaliente(folio) {
  const db = conexion();
  const t = db.prepare('SELECT id FROM tickets WHERE folio = ?').get(folio);
  const alerta = t && mapa.revisarZona(t.id);
  if (!alerta) return;
  const titulo = `Zona caliente: Edificio ${alerta.edificio} · ${alerta.categoria}`;
  const mensaje = `${alerta.reportes} reportes en ${alerta.dias} días (umbral ${alerta.umbral}). Revisa el mapa de calor.`;
  const destinatarios = db.prepare("SELECT id FROM usuarios WHERE rol IN ('admin','mantenimiento') AND activo = 1").all();
  for (const u of destinatarios) {
    tickets.notificar(db, u.id, t.id, titulo, mensaje);
  }
}

const router = express.Router();

/* GET /api/tickets — lista según el rol */
router.get('/', (req, res) => {
  res.json(tickets.listar(req.usuario));
});

/* POST /api/tickets — levantar incidencia */
router.post('/', requiereRol('solicitante', 'admin'), (req, res) => {
  const folio = tickets.crear(req.usuario, req.body);
  alertaZonaCaliente(folio);
  emitir('ticket-creado');
  res.status(201).json({ folio });
});

/* POST /api/tickets/:folio/transicion — cambiar de estado */
router.post('/:folio/transicion', (req, res) => {
  tickets.transicion(req.usuario, req.params.folio, req.body);
  emitir('ticket-actualizado');
  res.json({ ok: true });
});

/* DELETE /api/tickets/:folio — cancelar (solicitante) o eliminar (admin) */
router.delete('/:folio', (req, res) => {
  tickets.eliminar(req.usuario, req.params.folio);
  emitir('ticket-eliminado');
  res.json({ ok: true });
});

module.exports = router;
