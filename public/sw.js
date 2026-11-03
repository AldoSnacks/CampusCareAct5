/* =========================================================
   CampusCare · Service Worker (caché del navegador)

   Estrategias:
   - App shell (HTML, CSS, JS, íconos): se precarga al instalar
     y se sirve "stale-while-revalidate" (rápido desde caché y
     se actualiza en segundo plano).
   - Imágenes y fotos: "cache-first" (si ya está, no se descarga).
   - API (GET): "network-first" con respaldo en caché, para
     poder consultar la última información sin internet.
   - Navegación: si no hay red se muestra la app guardada o
     la página offline.html.

   IMPORTANTE: cambia VERSION cada vez que publiques cambios en
   el frontend, así los navegadores descargan la versión nueva.
   ========================================================= */
const VERSION = 'v3.0.0';
const CACHE_APP = `campuscare-app-${VERSION}`;
const CACHE_IMG = 'campuscare-imagenes';
const CACHE_API = 'campuscare-api';
const MAX_IMAGENES = 80;

const APP_SHELL = [
  './',
  'index.html',
  'offline.html',
  'styles.css',
  'app.js',
  'admin.js',
  'pwa.js',
  'mapacalor.js',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'img/logo.png',
  'img/hero-campus.jpg'
];

/* Instalación: precarga del app shell */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_APP).then(cache => cache.addAll(APP_SHELL))
  );
});

/* Activación: borra cachés de versiones anteriores */
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const nombres = await caches.keys();
    await Promise.all(nombres
      .filter(n => n.startsWith('campuscare-app-') && n !== CACHE_APP)
      .map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

/* Mensajes desde la página */
self.addEventListener('message', event => {
  const { tipo } = event.data || {};
  if (tipo === 'saltar-espera') self.skipWaiting();
  if (tipo === 'limpiar-api') caches.delete(CACHE_API);
  if (tipo === 'version') event.source?.postMessage({ tipo: 'version', version: VERSION });
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;                   // POST, PUT, DELETE siempre van a la red
  const url = new URL(req.url);

  if (url.pathname.startsWith('/api/')) {
    if (url.pathname === '/api/eventos' || url.pathname.startsWith('/api/admin/') || url.pathname.startsWith('/api/push/')
      || url.pathname === '/api/mapa-calor/diagnostico') return; // tiempo real, panel admin, push y diagnóstico: siempre en vivo
    event.respondWith(redPrimero(req));
    return;
  }
  if (url.origin !== location.origin) return;         // fuentes de Google y otros dominios: manejo normal del navegador

  if (req.mode === 'navigate') {
    event.respondWith(navegacion(req));
    return;
  }
  if (/\.(png|jpe?g|webp|svg|ico)$/i.test(url.pathname)) {
    event.respondWith(cachePrimero(req));
    return;
  }
  event.respondWith(cacheYActualiza(req));
});

/* =========================================================
   NOTIFICACIONES PUSH (Punto 14)
   El servidor envía el mensaje cifrado; el navegador lo entrega
   aquí aunque la aplicación esté cerrada.
   ========================================================= */
self.addEventListener('push', event => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { cuerpo: event.data?.text() }; }
  const opciones = {
    body: d.cuerpo || 'Tienes una actualización en CampusCare.',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    vibrate: [120, 60, 120],
    data: { url: d.url || '/' }
  };
  if (d.etiqueta) { opciones.tag = d.etiqueta; opciones.renotify = true; }
  event.waitUntil(self.registration.showNotification(d.titulo || 'CampusCare', opciones));
});

/* Al tocar la notificación se abre (o enfoca) la app en la sección indicada */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const destino = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const v of ventanas) {
      if (v.url.startsWith(self.location.origin)) {
        await v.focus();
        if ('navigate' in v) await v.navigate(destino);
        return;
      }
    }
    await self.clients.openWindow(destino);
  })());
});

/* network-first: intenta la red; si falla, usa lo último guardado */
async function redPrimero(req) {
  const cache = await caches.open(CACHE_API);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const guardada = await cache.match(req);
    if (guardada) {
      const cuerpo = await guardada.blob();
      const headers = new Headers(guardada.headers);
      headers.set('X-Desde-Cache', 'service-worker');
      return new Response(cuerpo, { status: 200, headers });
    }
    return new Response(JSON.stringify({ error: 'Sin conexión: esta información aún no está guardada en el dispositivo.' }), {
      status: 503, headers: { 'Content-Type': 'application/json' }
    });
  }
}

/* cache-first: imágenes */
async function cachePrimero(req) {
  const cache = await caches.open(CACHE_IMG);
  const guardada = await cache.match(req);
  if (guardada) return guardada;
  try {
    const res = await fetch(req);
    if (res.ok) {
      await cache.put(req, res.clone());
      recortar(cache, MAX_IMAGENES);
    }
    return res;
  } catch {
    return new Response('', { status: 504 });
  }
}

/* stale-while-revalidate: CSS y JS */
async function cacheYActualiza(req) {
  const cache = await caches.open(CACHE_APP);
  const guardada = await cache.match(req, { ignoreSearch: true });
  const deRed = fetch(req).then(res => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  return guardada || (await deRed) || new Response('', { status: 504 });
}

/* Navegación: red primero, luego la app guardada, luego offline.html */
async function navegacion(req) {
  const cache = await caches.open(CACHE_APP);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put('index.html', res.clone());
    return res;
  } catch {
    return (await cache.match('index.html')) || (await cache.match('offline.html'));
  }
}

/* Mantiene la caché de imágenes por debajo del límite */
async function recortar(cache, maximo) {
  const claves = await cache.keys();
  for (let i = 0; i < claves.length - maximo; i++) await cache.delete(claves[i]);
}
