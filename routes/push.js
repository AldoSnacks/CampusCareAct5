/* =========================================================
   /api/push — suscripción a notificaciones push (Punto 14)
   ========================================================= */
'use strict';
const express = require('express');
const { conexion, fecha } = require('../src/db');
const { ErrorHttp } = require('../src/auth');
const push = require('../src/push');

const router = express.Router();

function navegadorDe(ua = '') {
  const so = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac OS X/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'Otro';
  const nav = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  return `${nav} · ${so}`;
}

/* GET /api/push/clave — llave pública VAPID para suscribirse */
router.get('/clave', (req, res) => {
  res.json({ clave: push.clavePublica() });
});

/* POST /api/push/suscripcion  { endpoint, keys: { p256dh, auth } } */
router.post('/suscripcion', (req, res) => {
  const s = req.body || {};
  if (!s.endpoint || !/^https:\/\//.test(s.endpoint) || !s.keys?.p256dh || !s.keys?.auth) {
    throw new ErrorHttp(400, 'Suscripción push inválida.');
  }
  conexion().prepare(`INSERT INTO push_suscripciones (usuario_id, endpoint, p256dh, auth, navegador, creado_en)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET usuario_id = excluded.usuario_id, p256dh = excluded.p256dh, auth = excluded.auth, navegador = excluded.navegador`)
    .run(req.usuario.id, s.endpoint, s.keys.p256dh, s.keys.auth, navegadorDe(req.headers['user-agent']), fecha());
  res.status(201).json({ ok: true });
});

/* DELETE /api/push/suscripcion  { endpoint } */
router.delete('/suscripcion', (req, res) => {
  conexion().prepare('DELETE FROM push_suscripciones WHERE endpoint = ? AND usuario_id = ?').run(String(req.body?.endpoint || ''), req.usuario.id);
  res.json({ ok: true });
});

/* POST /api/push/prueba — envía un aviso de prueba a los dispositivos del usuario */
router.post('/prueba', async (req, res, next) => {
  try {
    const resultados = await push.enviarAUsuario(req.usuario.id, {
      titulo: 'CampusCare · Prueba de notificación',
      cuerpo: `Hola ${req.usuario.nombre.split(' ')[0]}, las notificaciones push funcionan correctamente. Toca para abrir el mapa de calor.`,
      url: '/#mapacalor', etiqueta: 'prueba'
    });
    if (!resultados.length) throw new ErrorHttp(400, 'Este usuario no tiene dispositivos suscritos. Activa las notificaciones primero.');
    res.json({ enviados: resultados.filter(r => r.ok).length, resultados });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
