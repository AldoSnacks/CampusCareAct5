/* =========================================================
   Tiempo real (RF-05) con Server-Sent Events
   Cada navegador conectado recibe un aviso cuando cambia algo
   en la base de datos y vuelve a pedir la información.
   ========================================================= */
'use strict';
const cache = require('./cache');
const push = require('./push');

const clientes = new Set();

function conectar(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write('retry: 3000\n\n');

  const cliente = { res, usuarioId: req.usuario.id };
  clientes.add(cliente);
  enviar(cliente, 'conectado', { ok: true });

  const latido = setInterval(() => res.write(': latido\n\n'), 25000);
  req.on('close', () => {
    clearInterval(latido);
    clientes.delete(cliente);
  });
}

function enviar(cliente, evento, datos) {
  try {
    cliente.res.write(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`);
  } catch {
    clientes.delete(cliente);
  }
}

/* Avisa a todos los navegadores que hubo un cambio */
function emitir(motivo = 'cambio') {
  cache.invalidar(); // los datos cambiaron: la caché del servidor ya no sirve
  push.despachar();  // envía las notificaciones push que quedaron en cola
  for (const c of clientes) enviar(c, 'cambio', { motivo, at: Date.now() });
}

const totalConectados = () => clientes.size;

module.exports = { conectar, emitir, totalConectados };
