/* =========================================================
   Guardado de fotografías de evidencia en la carpeta uploads/
   En la base de datos solo se guarda la ruta del archivo.
   ========================================================= */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ErrorHttp } = require('./auth');

// En el hosting se puede apuntar a un disco persistente con la variable UPLOADS_DIR
const CARPETA = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
const MAX_BYTES = 6 * 1024 * 1024;
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/* Recibe la imagen como data URL (base64) y devuelve "uploads/archivo.jpg" */
function guardarFoto(dataUrl, prefijo = 'foto') {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new ErrorHttp(400, 'La fotografía no tiene un formato válido (JPG, PNG o WEBP).');
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length > MAX_BYTES) throw new ErrorHttp(400, 'La fotografía supera los 6 MB.');
  fs.mkdirSync(CARPETA, { recursive: true });
  const nombre = `${prefijo}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${EXT[m[1]]}`;
  fs.writeFileSync(path.join(CARPETA, nombre), bytes);
  return `uploads/${nombre}`;
}

/* Borra archivos de uploads/ (ignora rutas de img/ y valores vacíos) */
function borrarFotos(...rutas) {
  for (const ruta of rutas.flat()) {
    if (!ruta || !String(ruta).startsWith('uploads/')) continue;
    const archivo = path.join(CARPETA, path.basename(ruta));
    fs.rm(archivo, { force: true }, () => {});
  }
}

function vaciarCarpeta() {
  if (!fs.existsSync(CARPETA)) return;
  for (const f of fs.readdirSync(CARPETA)) {
    if (f !== '.gitkeep') fs.rmSync(path.join(CARPETA, f), { force: true });
  }
}

module.exports = { guardarFoto, borrarFotos, vaciarCarpeta, CARPETA };
