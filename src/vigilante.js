/* =========================================================
   Vigilante de la base de datos — Punto 11
   Detecta cambios hechos FUERA de la aplicación (DB Browser,
   SQLite Viewer, otro programa) con PRAGMA data_version, que
   SQLite incrementa cada vez que otra conexión confirma un
   cambio. Al detectarlo, invalida la caché del servidor y
   avisa a todos los navegadores para que se actualicen.
   ========================================================= */
'use strict';
const { conexion } = require('./db');
const cache = require('./cache');

const estado = {
  version: null,
  ultimoCambioExterno: null,
  cambiosExternos: 0,
  ultimoCambioApp: null,
  revisiones: 0
};

function iniciar(emitir, intervaloMs = 2000) {
  estado.version = conexion().prepare('PRAGMA data_version').get().data_version;
  const t = setInterval(() => {
    try {
      const v = conexion().prepare('PRAGMA data_version').get().data_version;
      estado.revisiones++;
      if (v !== estado.version) {
        estado.version = v;
        estado.ultimoCambioExterno = Date.now();
        estado.cambiosExternos++;
        cache.invalidar();
        emitir('cambio-externo');
      }
    } catch { /* base ocupada momentáneamente: se reintenta */ }
  }, intervaloMs);
  t.unref();
}

const registrarCambioApp = () => { estado.ultimoCambioApp = Date.now(); };

module.exports = { iniciar, estado, registrarCambioApp };
