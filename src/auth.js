/* =========================================================
   Autenticación con JWT y autorización por rol (RF-01)
   ========================================================= */
'use strict';
const jwt = require('jsonwebtoken');
const { conexion } = require('./db');

const SECRETO = process.env.JWT_SECRET || 'campuscare-secreto-de-desarrollo-cambiar-en-produccion';
const DOMINIO = '@institucion.edu.mx';
const VIGENCIA = '8h';

class ErrorHttp extends Error {
  constructor(status, mensaje) {
    super(mensaje);
    this.status = status;
  }
}

function firmarToken(u) {
  return jwt.sign(
    { sub: u.correo, uid: u.id, name: u.nombre, role: u.rol, avatar: u.avatar || null },
    SECRETO,
    { expiresIn: VIGENCIA }
  );
}

/* Verifica el token y carga al usuario desde la base (así un cambio de rol o una baja aplica al instante) */
function requiereSesion(req, res, next) {
  const cabecera = req.headers.authorization || '';
  const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7) : req.query.token;
  if (!token) return next(new ErrorHttp(401, 'Inicia sesión para continuar.'));

  let datos;
  try {
    datos = jwt.verify(token, SECRETO);
  } catch {
    return next(new ErrorHttp(401, 'Tu sesión expiró. Inicia sesión de nuevo.'));
  }

  const usuario = conexion()
    .prepare('SELECT id, correo, nombre, rol, avatar, activo FROM usuarios WHERE id = ?')
    .get(datos.uid);
  if (!usuario) return next(new ErrorHttp(401, 'Tu cuenta ya no existe.'));
  if (!usuario.activo) return next(new ErrorHttp(401, 'Tu cuenta fue desactivada por el administrador.'));

  req.usuario = usuario;
  next();
}

function requiereRol(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.usuario.rol)) return next(new ErrorHttp(403, 'Tu rol no tiene permiso para esta acción.'));
    next();
  };
}

function validarCorreo(correo) {
  correo = String(correo || '').trim().toLowerCase();
  if (!correo) throw new ErrorHttp(400, 'Ingresa tu correo institucional.');
  if (!correo.endsWith(DOMINIO)) throw new ErrorHttp(400, `Solo se permiten cuentas institucionales (${DOMINIO}).`);
  if (!/^[a-z0-9._-]+@institucion\.edu\.mx$/.test(correo)) throw new ErrorHttp(400, 'El formato del correo no es válido.');
  return correo;
}

module.exports = { firmarToken, requiereSesion, requiereRol, validarCorreo, ErrorHttp, DOMINIO };
