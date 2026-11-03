/* =========================================================
   CampusCare · pwa.js
   - Registra el Service Worker (caché del navegador)
   - Avisa cuando hay una versión nueva de la app
   - Botón para instalar la app en el celular o la computadora
   - Indicador de "sin conexión"
   - Vista "Caché y modo sin conexión" para el administrador
   Se carga después de app.js y admin.js.
   ========================================================= */
'use strict';

const PWA = {
  registro: null,
  version: null,
  instalar: null,          // evento beforeinstallprompt guardado
  soportado: 'serviceWorker' in navigator,
  cachesInfo: null,
  servidor: null,
  encabezados: null,
  almacenamiento: null
};

/* ---------- Registro del Service Worker ---------- */
async function registrarSW() {
  if (!PWA.soportado) return;
  try {
    PWA.registro = await navigator.serviceWorker.register('sw.js');
    vigilarActualizacion(PWA.registro);
    pedirVersion();
  } catch (err) {
    console.warn('No se pudo registrar el Service Worker:', err.message);
  }
}

function pedirVersion() {
  navigator.serviceWorker.controller?.postMessage({ tipo: 'version' });
}

navigator.serviceWorker?.addEventListener('message', e => {
  if (e.data?.tipo === 'version') {
    PWA.version = e.data.version;
    if (state.vista === 'cache') pintarCache();
  }
});

/* Cuando hay un Service Worker nuevo esperando, se ofrece actualizar */
function vigilarActualizacion(reg) {
  if (reg.waiting && navigator.serviceWorker.controller) mostrarAvisoActualizacion(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const nuevo = reg.installing;
    nuevo?.addEventListener('statechange', () => {
      if (nuevo.state === 'installed' && navigator.serviceWorker.controller) mostrarAvisoActualizacion(nuevo);
    });
  });
}

let recargando = false;
navigator.serviceWorker?.addEventListener('controllerchange', () => {
  if (recargando) return;
  recargando = true;
  location.reload();
});

function mostrarAvisoActualizacion(sw) {
  if ($('#avisoVersion')) return;
  const barra = document.createElement('div');
  barra.id = 'avisoVersion';
  barra.className = 'update-bar';
  barra.innerHTML = `${icon('refresh')}<span><strong>Hay una versión nueva de CampusCare.</strong> Actualiza para usar los últimos cambios.</span>
    <button class="btn btn-light btn-sm" type="button">Actualizar ahora</button>`;
  barra.querySelector('button').addEventListener('click', () => sw.postMessage({ tipo: 'saltar-espera' }));
  document.body.appendChild(barra);
}

/* ---------- Instalación de la app ---------- */
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  PWA.instalar = e;
  pintarBotonInstalar();
  if (state.vista === 'cache') pintarCache();
});
window.addEventListener('appinstalled', () => {
  PWA.instalar = null;
  pintarBotonInstalar();
  toast('App instalada', 'CampusCare ya aparece entre tus aplicaciones.');
});

function pintarBotonInstalar() {
  let btn = $('#btnInstalar');
  if (!PWA.instalar) { btn?.remove(); return; }
  if (btn) return;
  btn = document.createElement('button');
  btn.id = 'btnInstalar';
  btn.className = 'icon-btn';
  btn.title = 'Instalar CampusCare';
  btn.setAttribute('aria-label', 'Instalar aplicación');
  btn.dataset.action = 'pwa-instalar';
  btn.innerHTML = icon('download');
  $('.topbar-actions')?.prepend(btn);
}

/* ---------- Indicador de conexión ---------- */
function pintarConexion() {
  let barra = $('#barraOffline');
  if (navigator.onLine) { barra?.remove(); return; }
  if (barra) return;
  barra = document.createElement('div');
  barra.id = 'barraOffline';
  barra.className = 'offline-bar';
  barra.innerHTML = `${icon('wifiOff')}<span><strong>Sin conexión.</strong> Estás viendo la última información guardada en caché. Para reportar o cambiar estados necesitas internet.</span>`;
  document.body.appendChild(barra);
}
window.addEventListener('online', () => {
  pintarConexion();
  toast('Conexión recuperada', 'Se actualizó la información con el servidor.', 'info');
  if (Auth.sesion()) sincronizar().catch(() => {});
  if (state.vista === 'cache') pintarCache();
});
window.addEventListener('offline', () => {
  pintarConexion();
  if (state.vista === 'cache') pintarCache();
});

/* =========================================================
   VISTA: CACHÉ Y MODO SIN CONEXIÓN (administrador)
   ========================================================= */
const fmtBytes = b => b == null ? '—' : b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(2)} MB`;
const ESTRATEGIAS = {
  'campuscare-app': ['Stale-while-revalidate', 'HTML, CSS, JS e íconos. Se precargan al instalar y se sirven al instante desde la caché mientras se descarga la versión nueva en segundo plano.'],
  'campuscare-imagenes': ['Cache-first', 'Imágenes y fotos de evidencia. Si ya están guardadas no se vuelven a descargar (máximo 80).'],
  'campuscare-api': ['Network-first', 'Respuestas de la API. Siempre se pide al servidor; si no hay internet se muestra la última respuesta guardada.']
};

RENDER.cache = () => `
  <section class="hero-banner hero-sm" style="--bg:url('img/hero-campus.jpg')">
    <div class="hero-banner-content">
      <span class="pill pill-glass">${icon('layers')} Service Worker · Cache Storage · HTTP</span>
      <h2>Caché y modo sin conexión</h2>
      <p>CampusCare guarda archivos y datos en tres niveles para cargar más rápido, gastar menos datos y seguir funcionando sin internet.</p>
      <div class="btn-row">
        <button class="btn btn-light" data-action="cache-refrescar">${icon('refresh')} Volver a medir</button>
        <button class="btn btn-glass" data-action="pwa-instalar">${icon('download')} Instalar app</button>
      </div>
    </div>
  </section>
  <div id="cacheContenido">${contenidoCache()}</div>`;

function contenidoCache() {
  const sw = navigator.serviceWorker?.controller;
  const totalCache = PWA.cachesInfo ? PWA.cachesInfo.reduce((a, c) => a + c.bytes, 0) : null;
  const est = PWA.almacenamiento;
  const pctUso = est?.quota ? Math.max(0.5, est.usage / est.quota * 100) : 0;
  const srv = PWA.servidor;
  return `
  <section class="stat-grid">
    <article class="stat-card"><span class="stat-ic">${icon('shield')}</span><div><strong>${!PWA.soportado ? 'No' : sw ? 'Activo' : 'Instalando'}</strong><span>Service Worker ${PWA.version ? `· ${esc(PWA.version)}` : ''}</span></div></article>
    <article class="stat-card tone-1"><span class="stat-ic">${icon('database')}</span><div><strong>${fmtBytes(totalCache)}</strong><span>En caché del navegador</span></div></article>
    <article class="stat-card tone-2"><span class="stat-ic">${icon(navigator.onLine ? 'wifi' : 'wifiOff')}</span><div><strong>${navigator.onLine ? 'En línea' : 'Sin conexión'}</strong><span>Estado de la red</span></div></article>
    <article class="stat-card"><span class="stat-ic">${icon('zap')}</span><div><strong>${srv ? `${srv.tasaAciertos}%` : '…'}</strong><span>Aciertos en caché del servidor</span></div></article>
  </section>

  <section class="card">
    <div class="card-head">
      <div><h3>1 · Caché del navegador (Service Worker)</h3><p class="muted small">Archivos guardados en el dispositivo con la Cache Storage API.</p></div>
      <div class="btn-row">
        <button class="btn btn-ghost btn-sm" data-action="pwa-buscar-version">${icon('refresh')} Buscar versión nueva</button>
        <button class="btn btn-danger btn-sm" data-action="cache-vaciar-navegador">${icon('trash')} Vaciar caché del navegador</button>
      </div>
    </div>
    ${!PWA.soportado ? vacio('Este navegador no admite Service Workers', 'Prueba con Chrome, Edge o Firefox recientes.', 'alert')
      : !PWA.cachesInfo ? vacio('Midiendo la caché…', '', 'database')
      : !PWA.cachesInfo.length ? vacio('La caché está vacía', 'Recarga la página para que el Service Worker vuelva a guardar los archivos.', 'database')
      : `<div class="cache-list">${PWA.cachesInfo.map(c => {
          const base = Object.keys(ESTRATEGIAS).find(k => c.nombre.startsWith(k));
          const [estrategia, desc] = ESTRATEGIAS[base] || ['—', ''];
          return `<details class="cache-item">
            <summary><span class="cache-name"><code>${esc(c.nombre)}</code><span class="chip st-asignado">${estrategia}</span></span>
              <span class="cache-meta"><b>${c.entradas.length}</b> archivos · <b>${fmtBytes(c.bytes)}</b></span></summary>
            <p class="muted small">${desc}</p>
            <ul class="cache-urls">${c.entradas.slice(0, 40).map(e => `<li><span>${esc(e.url)}</span><small>${fmtBytes(e.bytes)}</small></li>`).join('')}${c.entradas.length > 40 ? `<li class="muted">… y ${c.entradas.length - 40} más</li>` : ''}</ul>
          </details>`;
        }).join('')}</div>`}
    ${est ? `<div class="storage-box"><div class="results-head"><strong class="small">Almacenamiento usado por el sitio</strong><span class="small muted">${fmtBytes(est.usage)} de ${fmtBytes(est.quota)} disponibles</span></div><div class="bar"><i style="width:${pctUso}%"></i></div></div>` : ''}
  </section>

  <div class="grid-2">
    <section class="card">
      <div class="card-head">
        <div><h3>2 · Caché HTTP (encabezados)</h3><p class="muted small">Reglas que el servidor envía en <code>Cache-Control</code> y <code>ETag</code>.</p></div>
        <button class="btn btn-ghost btn-sm" data-action="cache-probar-http">${icon('play')} Probar</button>
      </div>
      ${PWA.encabezados ? `<div class="table-wrap"><table class="table cache-table">
        <thead><tr><th>Recurso</th><th>Cache-Control</th><th>ETag</th><th>X-Cache</th></tr></thead>
        <tbody>${PWA.encabezados.map(h => `<tr>
          <td data-label="Recurso"><code>${esc(h.url)}</code><small>${h.status} · ${h.ms} ms</small></td>
          <td data-label="Cache-Control"><code>${esc(h.cc || '—')}</code></td>
          <td data-label="ETag">${h.etag ? `<code title="${esc(h.etag)}">${esc(h.etag.slice(0, 14))}…</code>` : '<span class="muted">—</span>'}</td>
          <td data-label="X-Cache">${h.xcache ? `<span class="chip ${h.xcache === 'HIT' ? 'st-resuelto' : 'st-en-proceso'}">${h.xcache}</span>` : '<span class="muted">—</span>'}</td>
        </tr>`).join('')}</tbody></table></div>`
      : `<ul class="policy-list">
          <li><code>index.html</code>, <code>sw.js</code> → <b>no-cache</b>: siempre se revisa si hay versión nueva.</li>
          <li><code>styles.css</code>, <code>app.js</code> → <b>max-age=0, must-revalidate</b> + ETag (respuesta 304 si no cambió).</li>
          <li><code>img/</code> → <b>max-age=604800</b> (7 días).</li>
          <li><code>uploads/</code> (fotos) → <b>max-age=30 días, immutable</b>.</li>
          <li><code>/api/*</code> → <b>no-store</b> (datos personales), excepto el catálogo, que se revalida con ETag.</li>
        </ul><p class="muted small">Presiona “Probar” para ver los encabezados reales que envía el servidor.</p>`}
    </section>

    <section class="card">
      <div class="card-head">
        <div><h3>3 · Caché del servidor (memoria)</h3><p class="muted small">El catálogo y el resumen se guardan en memoria y se invalidan solos cuando cambia la base de datos.</p></div>
        <button class="btn btn-danger btn-sm" data-action="cache-vaciar-servidor">${icon('trash')} Vaciar</button>
      </div>
      ${srv ? `
        <div class="srv-stats">
          <div><strong>${srv.aciertos}</strong><span>Aciertos (HIT)</span></div>
          <div><strong>${srv.fallos}</strong><span>Fallos (MISS)</span></div>
          <div><strong>${srv.invalidaciones}</strong><span>Invalidaciones</span></div>
        </div>
        <div class="bar"><i style="width:${srv.tasaAciertos}%"></i></div>
        <p class="muted small">Tasa de aciertos: ${srv.tasaAciertos}% desde ${fmtFecha(srv.desde)}</p>
        ${srv.entradas.length ? `<ul class="cache-urls">${srv.entradas.map(e => `<li><span><code>${esc(e.clave)}</code> · usado ${e.usos} ${e.usos === 1 ? 'vez' : 'veces'}</span><small>${fmtBytes(e.bytes)} · expira en ${e.expiraEn} s</small></li>`).join('')}</ul>`
          : '<p class="muted small">Sin entradas guardadas en este momento.</p>'}`
        : vacio('Consultando al servidor…', '', 'database')}
    </section>
  </div>

  <section class="card install-card">
    <div><h3>${icon('download')} Instalar CampusCare</h3>
      <p class="small">${PWA.instalar ? 'Tu navegador permite instalar la app: se abrirá en su propia ventana y funcionará sin conexión.'
        : window.matchMedia('(display-mode: standalone)').matches ? 'Ya estás usando la app instalada.'
        : 'En Chrome o Edge usa el ícono de instalar en la barra de direcciones. En iPhone: Compartir → “Agregar a inicio”. La instalación requiere HTTPS, que el hosting ya incluye.'}</p></div>
    ${PWA.instalar ? `<button class="btn btn-light" data-action="pwa-instalar">${icon('download')} Instalar ahora</button>` : ''}
  </section>`;
}

function pintarCache() {
  const caja = $('#cacheContenido');
  if (caja && state.vista === 'cache') caja.innerHTML = contenidoCache();
}

/* Mide qué hay guardado en Cache Storage */
async function medirCaches() {
  if (!('caches' in window)) { PWA.cachesInfo = []; return; }
  const nombres = (await caches.keys()).filter(n => n.startsWith('campuscare'));
  PWA.cachesInfo = await Promise.all(nombres.map(async nombre => {
    const cache = await caches.open(nombre);
    const peticiones = await cache.keys();
    const entradas = await Promise.all(peticiones.map(async req => {
      const res = await cache.match(req);
      const bytes = res ? (await res.clone().blob()).size : 0;
      return { url: new URL(req.url).pathname + new URL(req.url).search, bytes };
    }));
    return { nombre, entradas, bytes: entradas.reduce((a, e) => a + e.bytes, 0) };
  }));
  PWA.almacenamiento = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
}

async function medirServidor() {
  try { PWA.servidor = await api('/admin/cache'); } catch { PWA.servidor = null; }
}

async function probarHttp() {
  const recursos = ['index.html', 'styles.css', 'app.js', 'img/logo.png', '/api/publico/resumen', '/api/catalogo', '/api/catalogo', '/api/tickets'];
  const filas = [];
  for (const r of recursos) {
    const url = r.startsWith('/api') ? `${API_ORIGEN}${r}` : r;
    const inicio = performance.now();
    try {
      const res = await fetch(url, { cache: 'no-cache', headers: r.startsWith('/api') ? { Authorization: `Bearer ${Auth.token()}` } : {} });
      filas.push({ url: r, status: res.status, ms: Math.round(performance.now() - inicio), cc: res.headers.get('Cache-Control'), etag: res.headers.get('ETag'), xcache: res.headers.get('X-Cache') });
    } catch {
      filas.push({ url: r, status: 'sin red', ms: 0 });
    }
  }
  PWA.encabezados = filas;
}

POST_RENDER.cache = async () => {
  pedirVersion();
  await Promise.all([medirCaches(), medirServidor()]);
  pintarCache();
};

Object.assign(ACCIONES, {
  'pwa-instalar': async () => {
    if (!PWA.instalar) {
      toast('Instalación', 'Usa el ícono de instalar en la barra de direcciones del navegador (Chrome/Edge) o "Agregar a inicio" en el celular.', 'info');
      return;
    }
    PWA.instalar.prompt();
    await PWA.instalar.userChoice;
    PWA.instalar = null;
    pintarBotonInstalar();
    pintarCache();
  },
  'pwa-buscar-version': async () => {
    if (!PWA.registro) throw new Error('El Service Worker no está registrado.');
    await PWA.registro.update();
    toast('Versión revisada', PWA.registro.waiting || PWA.registro.installing ? 'Se encontró una versión nueva.' : `Ya tienes la versión más reciente (${PWA.version || 'actual'}).`, 'info');
  },
  'cache-refrescar': async () => {
    await Promise.all([medirCaches(), medirServidor()]);
    pintarCache();
  },
  'cache-vaciar-navegador': async () => {
    if (!confirm('¿Vaciar la caché del navegador? La página volverá a descargar todos los archivos al recargar.')) return;
    const nombres = await caches.keys();
    await Promise.all(nombres.map(n => caches.delete(n)));
    await medirCaches();
    pintarCache();
    toast('Caché del navegador vacía', `Se eliminaron ${nombres.length} caché(s). Recarga la página para volver a llenarla.`);
  },
  'cache-vaciar-servidor': async () => {
    await api('/admin/cache', { method: 'DELETE' });
    await medirServidor();
    pintarCache();
    toast('Caché del servidor vacía', 'La siguiente consulta se leerá directo de la base de datos (MISS).');
  },
  'cache-probar-http': async () => {
    await probarHttp();
    await medirServidor();
    pintarCache();
  }
});

/* Al cerrar sesión se borran los datos personales guardados en caché */
function limpiarCacheApi() {
  navigator.serviceWorker?.controller?.postMessage({ tipo: 'limpiar-api' });
  if ('caches' in window) caches.delete('campuscare-mapa-calor'); // instantánea del mapa de calor (Cache API)
}

/* =========================================================
   NOTIFICACIONES PUSH REALES (Web Push + VAPID) — Punto 14
   ========================================================= */
PWA.pushActivo = false;
const pushSoportado = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function b64uABytes(txt) {
  const s = (txt + '='.repeat((4 - txt.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
function bytesAB64u(buf) {
  if (!buf) return '';
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* Pide permiso, se suscribe con la llave VAPID del servidor y guarda la suscripción en la BD */
async function activarPush() {
  if (!pushSoportado()) {
    throw new Error(/iPhone|iPad/.test(navigator.userAgent)
      ? 'En iPhone las notificaciones push requieren instalar la app primero (Safari → Compartir → Agregar a inicio) y abrirla desde el ícono.'
      : 'Este navegador no admite notificaciones push.');
  }
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') throw new Error('Permiso de notificaciones denegado. Actívalo desde el candado de la barra de direcciones.');
  const reg = await navigator.serviceWorker.ready;
  const { clave } = await api('/push/clave');
  let sub = await reg.pushManager.getSubscription();
  if (sub && bytesAB64u(sub.options?.applicationServerKey) !== clave) { await sub.unsubscribe(); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uABytes(clave) });
  await api('/push/suscripcion', { method: 'POST', body: sub.toJSON() });
  PWA.pushActivo = true;
  return sub;
}

/* Al iniciar sesión: si ya había permiso, vuelve a registrar el dispositivo para este usuario */
async function sincronizarPush() {
  try {
    if (pushSoportado() && Notification.permission === 'granted') await activarPush();
  } catch { PWA.pushActivo = false; }
}

/* Al cerrar sesión: el dispositivo deja de recibir avisos de esa cuenta */
async function pushAlCerrarSesion() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sub = await reg?.pushManager?.getSubscription();
    if (sub) api('/push/suscripcion', { method: 'DELETE', body: { endpoint: sub.endpoint } }).catch(() => {});
  } catch { /* sin soporte */ }
  PWA.pushActivo = false;
}

async function estadoPush() {
  if (!pushSoportado()) return { soportado: false, permiso: 'no disponible', suscrito: false };
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return { soportado: true, permiso: Notification.permission, suscrito: !!sub, endpoint: sub?.endpoint };
}

/* ---------- Arranque ---------- */
window.addEventListener('load', () => {
  registrarSW();
  pintarConexion();
});
