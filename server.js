/* =========================================================
   CampusCare · Servidor (Node.js + Express + SQLite)
   Inicia con:  npm start   →   http://localhost:3000
   ========================================================= */
'use strict';
const path = require('node:path');
const os = require('node:os');
const express = require('express');

const { abrir, conexion, DB_PATH } = require('./src/db');
const { sembrarSiVacia, PASSWORD_DEMO } = require('./src/seed');
const { requiereSesion, requiereRol, ErrorHttp } = require('./src/auth');
const eventos = require('./src/eventos');
const { CARPETA: UPLOADS } = require('./src/fotos');
const cache = require('./src/cache');
const vigilante = require('./src/vigilante');
const push = require('./src/push');

const PUERTO = Number(process.env.PORT) || 3000;
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.warn('  Aviso: define la variable JWT_SECRET en el hosting para firmar los tokens con una clave propia.');
}

/* ---------- Base de datos ---------- */
abrir();
const sembrada = sembrarSiVacia();
push.cargarLlaves();                 // llaves VAPID para notificaciones push
vigilante.iniciar(eventos.emitir);   // detecta cambios externos en la base de datos

/* ---------- Aplicación ---------- */
const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');

// Permite usar el frontend desde Live Server (otro puerto) durante el desarrollo
app.use('/api', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '12mb' })); // las fotos llegan en base64

// Caché HTTP: por defecto las respuestas de la API no se guardan (datos personales y cambiantes)
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// Registro de peticiones en la terminal
app.use('/api', (req, res, next) => {
  const inicio = Date.now();
  res.on('finish', () => {
    if (req.path === '/eventos') return;
    console.log(`  ${req.method.padEnd(6)} ${req.originalUrl.split('?')[0].padEnd(42)} ${res.statusCode}  ${Date.now() - inicio} ms`);
  });
  next();
});

/* ---------- Rutas públicas ---------- */
app.get('/api/salud', (req, res) => {
  res.json({ ok: true, baseDeDatos: path.basename(DB_PATH), conectados: eventos.totalConectados() });
});

app.get('/api/publico/resumen', (req, res) => {
  const { valor, hit } = cache.obtener('resumen-publico', 60, leerResumen);
  res.setHeader('X-Cache', hit ? 'HIT' : 'MISS');
  res.setHeader('Cache-Control', 'public, max-age=30'); // el navegador puede reutilizarla 30 s
  res.json(valor);
});

function leerResumen() {
  const db = conexion();
  const r = db.prepare(`
    SELECT COUNT(*) AS atendidos,
           SUM(CASE WHEN (julianday(r.resuelto_en) - julianday(t.creado_en)) * 24 <= s.sla_horas THEN 1 ELSE 0 END) AS a_tiempo
    FROM resoluciones r JOIN tickets t ON t.id = r.ticket_id JOIN severidades s ON s.nombre = t.severidad`).get();
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM edificios').get();
  return { atendidos: r.atendidos, sla: r.atendidos ? Math.round((r.a_tiempo || 0) / r.atendidos * 100) : 0, edificios: n };
}

app.use('/api/auth', require('./routes/auth'));

/* ---------- Rutas protegidas (requieren token JWT) ---------- */
app.get('/api/eventos', requiereSesion, eventos.conectar);
app.use('/api/catalogo', requiereSesion, require('./routes/catalogo'));
app.use('/api/tickets', requiereSesion, require('./routes/tickets'));
app.use('/api/notificaciones', requiereSesion, require('./routes/notificaciones'));
app.use('/api/usuarios', requiereSesion, requiereRol('admin'), require('./routes/usuarios'));
app.use('/api/admin', requiereSesion, requiereRol('admin'), require('./routes/admin'));
app.use('/api/mapa-calor', requiereSesion, requiereRol('admin', 'mantenimiento'), require('./routes/mapacalor'));
app.use('/api/push', requiereSesion, require('./routes/push'));

app.use('/api', (req, res, next) => next(new ErrorHttp(404, `No existe la ruta ${req.method} ${req.originalUrl}`)));

/* ---------- Archivos del frontend y fotografías ---------- */
// Las fotos tienen nombre único: nunca cambian, se pueden guardar 30 días
app.use('/uploads', express.static(UPLOADS, { maxAge: '30d', immutable: true }));

// Política de caché HTTP para el frontend
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, archivo) {
    const nombre = path.basename(archivo);
    if (/\.html$/.test(nombre) || nombre === 'sw.js' || nombre === 'manifest.json') {
      res.setHeader('Cache-Control', 'no-cache');                           // siempre se revisa si hay versión nueva
    } else if (/\.(css|js)$/.test(nombre)) {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate'); // se revalida con ETag (304 si no cambió)
    } else if (/\.(png|jpe?g|webp|svg|ico)$/.test(nombre)) {
      res.setHeader('Cache-Control', 'public, max-age=604800');             // imágenes: 7 días
    }
  }
}));

/* ---------- Manejo de errores ---------- */
function traducirErrorSQLite(mensaje) {
  if (/FOREIGN KEY constraint failed/i.test(mensaje)) return 'No se puede completar: otros registros dependen de este (por ejemplo, tickets que lo usan) o la referencia no existe.';
  let m = mensaje.match(/UNIQUE constraint failed: ([\w., ]+)/i);
  if (m) return `Ya existe un registro con ese valor (${m[1]}).`;
  m = mensaje.match(/CHECK constraint failed: (.+)/i);
  if (m) return `Valor no permitido por la regla: ${m[1]}.`;
  m = mensaje.match(/NOT NULL constraint failed: ([\w.]+)/i);
  if (m) return `El campo ${m[1]} es obligatorio.`;
  if (/syntax error|no such (column|table)/i.test(mensaje)) return `Error en la consulta SQL: ${mensaje}`;
  if (/database is locked|SQLITE_BUSY/i.test(mensaje)) return 'La base de datos está ocupada por otro programa (cierra los cambios pendientes en DB Browser).';
  return null;
}

app.use((err, req, res, next) => {
  push.descartar(); // si la operación falló, no se envían avisos pendientes
  if (res.headersSent) return next(err);
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'La información enviada es demasiado grande (máximo 12 MB).' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'El cuerpo de la petición no es JSON válido.' });
  if (err.status) return res.status(err.status).json({ error: err.message });
  const traducido = traducirErrorSQLite(err.message || '');
  if (traducido) return res.status(400).json({ error: traducido, detalle: err.message });
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

/* ---------- Inicio ---------- */
const servidor = app.listen(PUERTO, () => {
  const red = Object.values(os.networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal);
  console.log(`
  ==========================================================
    CampusCare · Servidor en marcha
  ----------------------------------------------------------
    En esta computadora:  http://localhost:${PUERTO}
    ${red ? `En tu celular (misma red Wi-Fi):  http://${red.address}:${PUERTO}` : ''}
    Base de datos:  ${DB_PATH}
    ${sembrada ? `Se cargaron datos de demostración (contraseña: ${PASSWORD_DEMO})` : 'Usando los datos guardados'}
    Para detener el servidor presiona  Ctrl + C
  ==========================================================
`);
});

servidor.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  El puerto ${PUERTO} ya está en uso. Cierra la otra terminal donde corre el servidor o usa otro puerto.\n`);
    process.exit(1);
  }
  throw err;
});
