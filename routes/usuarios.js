/* =========================================================
   /api/usuarios — administración de cuentas (solo admin)
   ========================================================= */
'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { conexion, fecha, aMs } = require('../src/db');
const { validarCorreo, ErrorHttp } = require('../src/auth');
const { borrarFotos } = require('../src/fotos');
const { emitir } = require('../src/eventos');

const router = express.Router();
const ROLES = ['solicitante', 'mantenimiento', 'admin'];

function leerDatos(body, nuevo) {
  const nombre = String(body.nombre || '').trim().replace(/\s+/g, ' ');
  if (nombre.length < 3) throw new ErrorHttp(400, 'Escribe el nombre completo.');
  const correo = validarCorreo(body.correo);
  const rol = ROLES.includes(body.rol) ? body.rol : null;
  if (!rol) throw new ErrorHttp(400, 'Selecciona un rol válido.');
  const activo = body.activo === false || body.activo === 0 || body.activo === '0' ? 0 : 1;
  const password = String(body.password || '');
  if (nuevo || password) {
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      throw new ErrorHttp(400, 'La contraseña debe tener 8 caracteres o más, con letras y números.');
    }
  }
  return { nombre, correo, rol, activo, password };
}

/* GET /api/usuarios */
router.get('/', (req, res) => {
  const filas = conexion().prepare(`
    SELECT u.id, u.correo, u.nombre, u.rol, u.avatar, u.activo, u.creado_en,
      (SELECT COUNT(*) FROM tickets t WHERE t.solicitante_id = u.id) AS reportes,
      (SELECT COUNT(*) FROM tickets t WHERE t.tecnico_id = u.id) AS asignados,
      (SELECT MAX(fecha) FROM accesos a WHERE a.usuario_id = u.id AND a.exito = 1 AND a.evento = 'Inicio de sesión') AS ultimo_acceso
    FROM usuarios u ORDER BY u.id`).all();
  res.json(filas.map(u => ({ ...u, activo: !!u.activo, creado_en: aMs(u.creado_en), ultimo_acceso: aMs(u.ultimo_acceso) })));
});

/* POST /api/usuarios */
router.post('/', (req, res) => {
  const d = leerDatos(req.body, true);
  const r = conexion().prepare('INSERT INTO usuarios (correo, nombre, rol, password_hash, activo, creado_en) VALUES (?, ?, ?, ?, ?, ?)')
    .run(d.correo, d.nombre, d.rol, bcrypt.hashSync(d.password, 10), d.activo, fecha());
  emitir('usuarios');
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

/* PUT /api/usuarios/:id */
router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const d = leerDatos(req.body, false);
  if (id === req.usuario.id && (d.rol !== 'admin' || !d.activo)) {
    throw new ErrorHttp(400, 'No puedes quitarte el rol de administrador ni desactivar tu propia cuenta.');
  }
  const db = conexion();
  const r = d.password
    ? db.prepare('UPDATE usuarios SET correo = ?, nombre = ?, rol = ?, activo = ?, password_hash = ? WHERE id = ?').run(d.correo, d.nombre, d.rol, d.activo, bcrypt.hashSync(d.password, 10), id)
    : db.prepare('UPDATE usuarios SET correo = ?, nombre = ?, rol = ?, activo = ? WHERE id = ?').run(d.correo, d.nombre, d.rol, d.activo, id);
  if (!r.changes) throw new ErrorHttp(404, 'El usuario no existe.');
  emitir('usuarios');
  res.json({ ok: true });
});

/* PATCH /api/usuarios/:id/activo  { activo } */
router.patch('/:id/activo', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.usuario.id) throw new ErrorHttp(400, 'No puedes desactivar tu propia cuenta.');
  const r = conexion().prepare('UPDATE usuarios SET activo = ? WHERE id = ?').run(req.body.activo ? 1 : 0, id);
  if (!r.changes) throw new ErrorHttp(404, 'El usuario no existe.');
  emitir('usuarios');
  res.json({ ok: true });
});

/* DELETE /api/usuarios/:id — borra la cuenta y, en cascada, sus reportes y notificaciones */
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.usuario.id) throw new ErrorHttp(400, 'No puedes eliminar tu propia cuenta.');
  const db = conexion();
  const fotos = db.prepare(`
    SELECT t.foto AS a, r.foto AS b FROM tickets t LEFT JOIN resoluciones r ON r.ticket_id = t.id
    WHERE t.solicitante_id = ?`).all(id).flatMap(f => [f.a, f.b]);
  const r = db.prepare('DELETE FROM usuarios WHERE id = ?').run(id);
  if (!r.changes) throw new ErrorHttp(404, 'El usuario no existe.');
  borrarFotos(fotos);
  emitir('usuarios');
  res.json({ ok: true });
});

module.exports = router;
