/* =========================================================
   Conexión a la base de datos SQLite
   Usa el módulo node:sqlite que viene incluido en Node.js 22+
   (no requiere instalar ni compilar nada extra).
   ========================================================= */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  console.error(`
  ============================================================
   Tu versión de Node.js (${process.version}) no incluye SQLite.
   Instala Node.js 22 LTS o más reciente desde https://nodejs.org
   y vuelve a ejecutar:  npm start
  ============================================================
`);
  process.exit(1);
}

const RAIZ = path.join(__dirname, '..');
const DB_PATH = process.env.DB_PATH || path.join(RAIZ, 'database', 'campuscare.db');
const SCHEMA_PATH = path.join(RAIZ, 'database', 'schema.sql');

let db = null;

function abrir() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  // Integridad referencial y espera si otro programa (DB Browser) tiene la base ocupada
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  return db;
}

function conexion() {
  if (!db) abrir();
  return db;
}

/* Ejecuta varias operaciones como una sola unidad (todo o nada) */
function transaccion(fn) {
  const d = conexion();
  d.exec('BEGIN');
  try {
    const r = fn(d);
    d.exec('COMMIT');
    return r;
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

/* Borra todas las tablas, vistas y triggers, y vuelve a crear el esquema */
function recrearEsquema() {
  const d = conexion();
  const objetos = d.prepare(
    "SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND type IN ('view','trigger','table')"
  ).all();
  d.exec('PRAGMA foreign_keys = OFF');
  try {
    for (const tipo of ['view', 'trigger', 'table']) {
      for (const o of objetos.filter(x => x.type === tipo)) {
        d.exec(`DROP ${tipo.toUpperCase()} IF EXISTS ${ident(o.name)}`);
      }
    }
  } finally {
    d.exec('PRAGMA foreign_keys = ON');
  }
  d.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
}

/* Fechas: texto legible en la base, milisegundos en la API */
const dos = n => String(n).padStart(2, '0');
function fecha(ms = Date.now()) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())} ${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}`;
}
function aMs(texto) {
  if (!texto) return null;
  const ms = new Date(String(texto).replace(' ', 'T')).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/* Comillas seguras para nombres de tablas y columnas */
const ident = nombre => `"${String(nombre).replace(/"/g, '""')}"`;

module.exports = { abrir, conexion, transaccion, recrearEsquema, fecha, aMs, ident, DB_PATH };
