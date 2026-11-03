/* =========================================================
   Notificaciones push reales (Web Push) — Punto 14
   ---------------------------------------------------------
   Implementación del estándar Web Push sin librerías extra:
   - VAPID (RFC 8292): el servidor se identifica con un par de
     llaves P-256 y firma un JWT (ES256) en cada envío.
   - Cifrado del mensaje (RFC 8291, "aes128gcm"): solo el
     navegador del usuario puede leer el contenido.
   El navegador entrega el aviso al Service Worker aunque la
   aplicación esté cerrada.
   ========================================================= */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');
const { conexion, fecha } = require('./db');

const ARCHIVO_LLAVES = process.env.VAPID_FILE || path.join(__dirname, '..', 'database', 'vapid.json');
const CONTACTO = process.env.VAPID_SUBJECT || 'mailto:mantenimiento@institucion.edu.mx';

const b64u = buf => Buffer.from(buf).toString('base64url');
const deB64u = txt => Buffer.from(String(txt), 'base64url');

/* ---------- Llaves VAPID ---------- */
let llaves = null;

function cargarLlaves() {
  if (llaves) return llaves;
  // 1) Variables de entorno (recomendado en el hosting)
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    llaves = { publica: process.env.VAPID_PUBLIC_KEY, privada: process.env.VAPID_PRIVATE_KEY, origen: 'variables de entorno' };
  } else {
    // 2) Archivo database/vapid.json (se crea solo la primera vez)
    try {
      const guardadas = JSON.parse(fs.readFileSync(ARCHIVO_LLAVES, 'utf8'));
      if (guardadas.publica && guardadas.privada) llaves = { ...guardadas, origen: 'database/vapid.json' };
    } catch { /* no existen todavía */ }
    if (!llaves) {
      const ecdh = crypto.createECDH('prime256v1');
      ecdh.generateKeys();
      llaves = { publica: b64u(ecdh.getPublicKey()), privada: b64u(ecdh.getPrivateKey()), creadas: fecha() };
      try {
        fs.mkdirSync(path.dirname(ARCHIVO_LLAVES), { recursive: true });
        fs.writeFileSync(ARCHIVO_LLAVES, JSON.stringify(llaves, null, 2));
      } catch { /* si no se puede escribir, se usan solo en memoria */ }
      llaves.origen = 'database/vapid.json (generadas)';
    }
  }
  const pub = deB64u(llaves.publica);
  llaves.objetoPrivado = crypto.createPrivateKey({
    format: 'jwk',
    key: { kty: 'EC', crv: 'P-256', d: llaves.privada, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }
  });
  return llaves;
}

const clavePublica = () => cargarLlaves().publica;

/* ---------- JWT de VAPID (ES256) ---------- */
function encabezadoVapid(endpoint) {
  const { publica, objetoPrivado } = cargarLlaves();
  const aud = new URL(endpoint).origin;
  const cabecera = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const cuerpo = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: CONTACTO }));
  const firma = crypto.sign('sha256', Buffer.from(`${cabecera}.${cuerpo}`), { key: objetoPrivado, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${cabecera}.${cuerpo}.${b64u(firma)}, k=${publica}`;
}

/* ---------- Cifrado del mensaje (RFC 8291 / RFC 8188) ---------- */
const hmac = (llave, datos) => crypto.createHmac('sha256', llave).update(datos).digest();

function cifrar(texto, p256dh, auth, prueba = {}) {
  const uaPublica = deB64u(p256dh);
  const secretoAuth = deB64u(auth);
  const ecdh = crypto.createECDH('prime256v1');
  if (prueba.privadaAS) ecdh.setPrivateKey(prueba.privadaAS); else ecdh.generateKeys();
  const asPublica = ecdh.getPublicKey();
  const secretoEcdh = ecdh.computeSecret(uaPublica);
  const sal = prueba.sal || crypto.randomBytes(16);

  const prkLlave = hmac(secretoAuth, secretoEcdh);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublica, asPublica, Buffer.from([1])]);
  const ikm = hmac(prkLlave, info);
  const prk = hmac(sal, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);

  const cifrador = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const datos = Buffer.concat([Buffer.from(texto, 'utf8'), Buffer.from([2])]); // 0x02 = último registro
  const cifrado = Buffer.concat([cifrador.update(datos), cifrador.final(), cifrador.getAuthTag()]);

  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([sal, rs, Buffer.from([asPublica.length]), asPublica, cifrado]);
}

/* ---------- Envío a un navegador ---------- */
function enviarA(suscripcion, mensaje) {
  return new Promise(resolve => {
    let cuerpo;
    try {
      cuerpo = cifrar(JSON.stringify(mensaje), suscripcion.p256dh, suscripcion.auth);
    } catch (e) {
      return resolve({ ok: false, status: 0, error: e.message });
    }
    const url = new URL(suscripcion.endpoint);
    const req = https.request({
      method: 'POST', hostname: url.hostname, port: url.port || 443, path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        'Content-Length': cuerpo.length,
        TTL: '86400',
        Urgency: mensaje.urgente ? 'high' : 'normal',
        Authorization: encabezadoVapid(suscripcion.endpoint)
      },
      timeout: 10000
    }, res => {
      let texto = '';
      res.on('data', d => { texto += d; });
      res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, error: texto.slice(0, 200) }));
    });
    req.on('timeout', () => req.destroy(new Error('Tiempo de espera agotado')));
    req.on('error', e => resolve({ ok: false, status: 0, error: e.message }));
    req.end(cuerpo);
  });
}

/* ---------- Envío a todos los dispositivos de un usuario ---------- */
async function enviarAUsuario(usuarioId, mensaje) {
  const db = conexion();
  const subs = db.prepare('SELECT * FROM push_suscripciones WHERE usuario_id = ?').all(usuarioId);
  const resultados = [];
  for (const s of subs) {
    const r = await enviarA(s, mensaje);
    resultados.push({ id: s.id, navegador: s.navegador, ...r });
    if (r.status === 404 || r.status === 410) {
      // La suscripción caducó o el usuario la quitó: se borra de la base de datos
      db.prepare('DELETE FROM push_suscripciones WHERE id = ?').run(s.id);
    } else if (r.ok) {
      db.prepare('UPDATE push_suscripciones SET ultimo_envio = ?, envios = envios + 1 WHERE id = ?').run(fecha(), s.id);
    }
  }
  return resultados;
}

/* ---------- Cola: los avisos se envían después de guardar en la BD ---------- */
const cola = [];
function encolar(usuarioId, titulo, cuerpo, extra = {}) {
  cola.push({ usuarioId, mensaje: { titulo, cuerpo, url: extra.url || '/#notificaciones', etiqueta: extra.etiqueta, urgente: !!extra.urgente } });
}
function despachar() {
  const lote = cola.splice(0);
  for (const { usuarioId, mensaje } of lote) enviarAUsuario(usuarioId, mensaje).catch(() => {});
}
function descartar() { cola.length = 0; }

module.exports = { clavePublica, cargarLlaves, enviarAUsuario, encolar, despachar, descartar, cifrar, encabezadoVapid };
