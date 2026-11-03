/* =========================================================
   /api/auth — inicio de sesión, registro y sesión actual
   ========================================================= */
'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { conexion, fecha } = require('../src/db');
const { firmarToken, requiereSesion, validarCorreo, ErrorHttp } = require('../src/auth');

const router = express.Router();

function registrarAcceso(usuarioId, correo, evento, exito, detalle, req) {
  conexion().prepare('INSERT INTO accesos (usuario_id, correo, evento, exito, detalle, ip, fecha) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(usuarioId, correo, evento, exito ? 1 : 0, detalle, req.ip || null, fecha());
}

const publico = u => ({ id: u.id, correo: u.correo, nombre: u.nombre, rol: u.rol, avatar: u.avatar });

/* POST /api/auth/login  { correo, password } */
router.post('/login', (req, res) => {
  const correoTexto = String(req.body.correo || '').trim().toLowerCase();
  let correo;
  try {
    correo = validarCorreo(correoTexto);
  } catch (e) {
    if (correoTexto) registrarAcceso(null, correoTexto, 'Inicio de sesión', false, 'Dominio no institucional', req);
    throw e;
  }
  const password = String(req.body.password || '');
  if (!password) throw new ErrorHttp(400, 'Ingresa tu contraseña.');

  const u = conexion().prepare('SELECT * FROM usuarios WHERE correo = ?').get(correo);
  if (!u) {
    registrarAcceso(null, correo, 'Inicio de sesión', false, 'Cuenta no registrada', req);
    throw new ErrorHttp(401, 'No existe una cuenta con ese correo. Crea tu cuenta primero.');
  }
  if (!bcrypt.compareSync(password, u.password_hash)) {
    registrarAcceso(u.id, correo, 'Inicio de sesión', false, 'Contraseña incorrecta', req);
    throw new ErrorHttp(401, 'Contraseña incorrecta.');
  }
  if (!u.activo) {
    registrarAcceso(u.id, correo, 'Inicio de sesión', false, 'Cuenta desactivada', req);
    throw new ErrorHttp(403, 'Tu cuenta está desactivada. Contacta al administrador.');
  }
  registrarAcceso(u.id, correo, 'Inicio de sesión', true, `Rol: ${u.rol}`, req);
  res.json({ token: firmarToken(u), usuario: publico(u) });
});

/* POST /api/auth/registro  { nombre, correo, password } */
router.post('/registro', (req, res) => {
  const nombre = String(req.body.nombre || '').trim().replace(/\s+/g, ' ');
  const correo = validarCorreo(req.body.correo);
  const password = String(req.body.password || '');
  if (nombre.length < 3) throw new ErrorHttp(400, 'Escribe tu nombre completo.');
  if (password.length < 8) throw new ErrorHttp(400, 'La contraseña debe tener al menos 8 caracteres.');
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) throw new ErrorHttp(400, 'La contraseña debe combinar letras y números.');

  const db = conexion();
  if (db.prepare('SELECT 1 FROM usuarios WHERE correo = ?').get(correo)) throw new ErrorHttp(409, 'Ya existe una cuenta con ese correo. Inicia sesión.');

  const r = db.prepare('INSERT INTO usuarios (correo, nombre, rol, password_hash, creado_en) VALUES (?, ?, ?, ?, ?)')
    .run(correo, nombre, 'solicitante', bcrypt.hashSync(password, 10), fecha());
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(Number(r.lastInsertRowid));
  registrarAcceso(u.id, correo, 'Registro de cuenta', true, 'Alta como Alumno / Docente', req);
  res.status(201).json({ token: firmarToken(u), usuario: publico(u) });
});

/* GET /api/auth/yo — datos frescos del usuario y token renovado */
router.get('/yo', requiereSesion, (req, res) => {
  res.json({ token: firmarToken(req.usuario), usuario: publico(req.usuario) });
});

/* PUT /api/auth/password  { actual, nueva } */
router.put('/password', requiereSesion, (req, res) => {
  const db = conexion();
  const u = db.prepare('SELECT password_hash FROM usuarios WHERE id = ?').get(req.usuario.id);
  if (!bcrypt.compareSync(String(req.body.actual || ''), u.password_hash)) throw new ErrorHttp(400, 'La contraseña actual no es correcta.');
  const nueva = String(req.body.nueva || '');
  if (nueva.length < 8 || !/[A-Za-z]/.test(nueva) || !/\d/.test(nueva)) throw new ErrorHttp(400, 'La nueva contraseña debe tener 8 caracteres o más, con letras y números.');
  db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(nueva, 10), req.usuario.id);
  registrarAcceso(req.usuario.id, req.usuario.correo, 'Cambio de contraseña', true, null, req);
  res.json({ ok: true });
});

module.exports = router;
