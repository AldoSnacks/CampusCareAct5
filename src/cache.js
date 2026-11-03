/* =========================================================
   Caché en memoria del servidor
   Guarda por un tiempo (TTL) respuestas que se piden mucho
   y cambian poco (catálogo, resumen público). Se invalida
   sola cada vez que alguien modifica la base de datos.
   ========================================================= */
'use strict';

const almacen = new Map();
const stats = { aciertos: 0, fallos: 0, invalidaciones: 0, desde: Date.now() };

/* Devuelve el valor guardado o lo calcula con producir() y lo guarda */
function obtener(clave, ttlSegundos, producir) {
  const ahora = Date.now();
  const e = almacen.get(clave);
  if (e && e.expira > ahora) {
    stats.aciertos++;
    e.usos++;
    return { valor: e.valor, hit: true };
  }
  stats.fallos++;
  const valor = producir();
  almacen.set(clave, { valor, creado: ahora, expira: ahora + ttlSegundos * 1000, usos: 0, bytes: Buffer.byteLength(JSON.stringify(valor)) });
  return { valor, hit: false };
}

/* Borra todo (se llama cuando cambia la base de datos) */
function invalidar() {
  if (almacen.size) stats.invalidaciones++;
  almacen.clear();
}

function estado() {
  const total = stats.aciertos + stats.fallos;
  return {
    entradas: [...almacen.entries()].map(([clave, e]) => ({
      clave, usos: e.usos, bytes: e.bytes, creado: e.creado, expiraEn: Math.max(0, Math.round((e.expira - Date.now()) / 1000))
    })),
    aciertos: stats.aciertos,
    fallos: stats.fallos,
    invalidaciones: stats.invalidaciones,
    tasaAciertos: total ? Math.round(stats.aciertos / total * 100) : 0,
    desde: stats.desde
  };
}

function reiniciar() {
  almacen.clear();
  Object.assign(stats, { aciertos: 0, fallos: 0, invalidaciones: 0, desde: Date.now() });
}

module.exports = { obtener, invalidar, estado, reiniciar };
