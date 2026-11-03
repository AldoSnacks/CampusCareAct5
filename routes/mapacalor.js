/* =========================================================
   /api/mapa-calor — API del mapa de calor
   Acceso: Administrador y Personal de Mantenimiento (JWT)
   ========================================================= */
'use strict';
const fs = require('node:fs');
const express = require('express');
const { conexion, fecha, aMs, ident, DB_PATH } = require('../src/db');
const { requiereRol, ErrorHttp } = require('../src/auth');
const mapa = require('../src/mapaCalor');
const eventos = require('../src/eventos');
const vigilante = require('../src/vigilante');
const push = require('../src/push');

const router = express.Router();
const soloAdmin = requiereRol('admin');

/* GET /api/mapa-calor?vista=categoria|nivel&dias=7|30|90|todo&severidad=&estado=todos|activos|cerrados */
router.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'private, no-cache');
  res.json(mapa.calcular(req.query));
});

/* GET /api/mapa-calor/detalle?vista=&fila=B&columna=Red/TI&dias=… — tickets de una celda */
router.get('/detalle', (req, res) => {
  res.json(mapa.detalle(req.query));
});

/* ---------- Configuración (umbral de zona caliente) ---------- */
router.get('/config', (req, res) => {
  const filas = conexion().prepare("SELECT * FROM configuracion WHERE clave LIKE 'mapa_%' ORDER BY clave").all();
  res.json(filas.map(f => ({ ...f, actualizado_en: aMs(f.actualizado_en) })));
});

router.put('/config', soloAdmin, (req, res) => {
  const umbral = Number(req.body.umbral);
  if (!Number.isInteger(umbral) || umbral < 1 || umbral > 50) throw new ErrorHttp(400, 'El umbral debe ser un número entero entre 1 y 50.');
  const r = conexion().prepare("UPDATE configuracion SET valor = ?, actualizado_por = ?, actualizado_en = ? WHERE clave = 'mapa_umbral_zona_caliente'")
    .run(String(umbral), req.usuario.nombre, fecha());
  if (!r.changes) throw new ErrorHttp(404, 'No existe la configuración del umbral.');
  eventos.emitir('mapa-config');
  res.json({ ok: true, umbral });
});

/* ---------- Historial de instantáneas (CRUD completo) ---------- */
router.get('/historial', (req, res) => {
  const filas = conexion().prepare(`
    SELECT h.id, h.vista, h.periodo, h.filtros, h.total, h.zona_max, h.nota, h.creado_en, u.nombre AS usuario
    FROM mapa_calor_historial h LEFT JOIN usuarios u ON u.id = h.usuario_id
    ORDER BY h.id DESC LIMIT 100`).all();
  res.json(filas.map(f => ({ ...f, filtros: JSON.parse(f.filtros || '{}'), creado_en: aMs(f.creado_en) })));
});

router.get('/historial/:id', (req, res) => {
  const f = conexion().prepare('SELECT * FROM mapa_calor_historial WHERE id = ?').get(req.params.id);
  if (!f) throw new ErrorHttp(404, 'La instantánea no existe.');
  res.json({ ...f, datos: JSON.parse(f.datos), filtros: JSON.parse(f.filtros || '{}'), creado_en: aMs(f.creado_en) });
});

router.post('/historial', soloAdmin, (req, res) => {
  const datos = mapa.calcular(req.body); // se recalcula en el servidor para guardar datos confiables
  const nota = String(req.body.nota || '').trim().slice(0, 200) || null;
  const zona = datos.zonaMax ? `Edificio ${datos.zonaMax.fila} · ${datos.zonaMax.columna} (${datos.zonaMax.reportes})` : null;
  const r = conexion().prepare(`INSERT INTO mapa_calor_historial (vista, periodo, filtros, datos, total, zona_max, nota, usuario_id, creado_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(datos.vista, datos.dias, JSON.stringify({ severidad: datos.severidad, estado: datos.estado }),
    JSON.stringify({ filas: datos.filas, columnas: datos.columnas, celdas: datos.celdas, max: datos.max, umbral: datos.umbral }),
    datos.total, zona, nota, req.usuario.id, fecha());
  eventos.emitir('mapa-historial');
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

router.patch('/historial/:id', soloAdmin, (req, res) => {
  const nota = String(req.body.nota ?? '').trim().slice(0, 200);
  const r = conexion().prepare('UPDATE mapa_calor_historial SET nota = ? WHERE id = ?').run(nota || null, req.params.id);
  if (!r.changes) throw new ErrorHttp(404, 'La instantánea no existe.');
  eventos.emitir('mapa-historial');
  res.json({ ok: true });
});

router.delete('/historial/:id', soloAdmin, (req, res) => {
  const r = conexion().prepare('DELETE FROM mapa_calor_historial WHERE id = ?').run(req.params.id);
  if (!r.changes) throw new ErrorHttp(404, 'La instantánea no existe.');
  eventos.emitir('mapa-historial');
  res.json({ ok: true });
});

/* ---------- Alertas de zona caliente ---------- */
router.get('/alertas', (req, res) => {
  const filas = conexion().prepare(`
    SELECT a.*, ed.nombre AS edificio, t.folio FROM mapa_calor_alertas a
    LEFT JOIN edificios ed ON ed.id = a.edificio_id LEFT JOIN tickets t ON t.id = a.ticket_id
    ORDER BY a.id DESC LIMIT 20`).all();
  res.json(filas.map(f => ({ ...f, creado_en: aMs(f.creado_en) })));
});

/* ---------- Diagnóstico para la lista de cotejo ---------- */
router.get('/diagnostico', (req, res) => {
  const db = conexion();
  const tablas = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .map(t => ({ nombre: t.name, registros: db.prepare(`SELECT COUNT(*) AS n FROM ${ident(t.name)}`).get().n }));
  let tamano = null;
  try { tamano = fs.statSync(DB_PATH).size; } catch { /* sin acceso */ }
  const llaves = push.cargarLlaves();
  res.json({
    servidor: {
      node: process.version, plataforma: `${process.platform} ${process.arch}`,
      express: require('express/package.json').version,
      jsonwebtoken: require('jsonwebtoken/package.json').version,
      bcryptjs: require('bcryptjs/package.json').version,
      activoDesde: Date.now() - Math.round(process.uptime() * 1000), hora: Date.now()
    },
    bd: {
      motor: 'SQLite', version: db.prepare('SELECT sqlite_version() AS v').get().v, archivo: 'database/campuscare.db', tamano,
      tablas, dataVersion: vigilante.estado.version, ultimoCambioExterno: vigilante.estado.ultimoCambioExterno,
      cambiosExternos: vigilante.estado.cambiosExternos, revisiones: vigilante.estado.revisiones
    },
    push: {
      configurado: true, origenLlaves: llaves.origen,
      misSuscripciones: db.prepare('SELECT id, navegador, envios, ultimo_envio, creado_en FROM push_suscripciones WHERE usuario_id = ?').all(req.usuario.id),
      totalSuscripciones: db.prepare('SELECT COUNT(*) AS n FROM push_suscripciones').get().n
    },
    tiempoReal: { conectados: eventos.totalConectados() },
    usuario: { nombre: req.usuario.nombre, rol: req.usuario.rol }
  });
});

module.exports = router;
