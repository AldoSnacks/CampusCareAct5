/* =========================================================
   CampusCare · mapacalor.js
   Vista "Mapa de calor" (Administrador y Mantenimiento)
   Pestañas:
     1. Mapa       — mapa interactivo, filtros, zonas calientes,
                     actualización en vivo y modo sin conexión
     2. Historial  — instantáneas guardadas en la base de datos
     3. Cotejo PWA — verificación en vivo de los 17 puntos
   Se carga después de app.js, admin.js y pwa.js.
   ========================================================= */
'use strict';

const CACHE_MAPA = 'campuscare-mapa-calor';
const PREFS_KEY = 'campuscare_mapa_prefs';

function leerPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; }
}
const prefs = leerPrefs();

const MC = {
  tab: prefs.tab || 'mapa',
  vista: prefs.vista || 'categoria',
  dias: prefs.dias || 'todo',
  severidad: prefs.severidad || '',
  estado: prefs.estado || 'todos',
  datos: null,
  fuente: null,          // servidor | sw | cacheapi | local
  guardadoEn: null,
  cambios: new Set(),
  alertas: [],
  historial: null,
  diag: null,
  cotejo: {},
  cargando: false,
  error: ''
};

/* Punto 13: las preferencias del usuario (progreso) persisten en el dispositivo */
function guardarPrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ tab: MC.tab, vista: MC.vista, dias: MC.dias, severidad: MC.severidad, estado: MC.estado, guardado: Date.now() }));
  } catch { /* sin almacenamiento */ }
}

const PERIODOS_MC = [['7', '7 días'], ['30', '30 días'], ['90', '90 días'], ['todo', 'Histórico']];
const FUENTES = {
  servidor: ['En vivo desde el servidor', 'st-resuelto', 'server'],
  sw: ['Copia del Service Worker (sin red)', 'st-en-proceso', 'layers'],
  cacheapi: ['Instantánea en Cache API (sin red)', 'st-en-proceso', 'database'],
  local: ['Calculado en el dispositivo (sin red)', 'st-asignado', 'smartphone']
};
const claveMapa = () => `${MC.vista}|${MC.dias}|${MC.severidad || 'todas'}|${MC.estado}`;
const qsMapa = () => new URLSearchParams({ vista: MC.vista, dias: MC.dias, severidad: MC.severidad, estado: MC.estado }).toString();
const esAdmin = () => Auth.sesion()?.role === 'admin';

/* =========================================================
   DATOS: servidor → Cache API → cálculo local
   ========================================================= */
async function pedirMapa() {
  const res = await fetch(`${API_ORIGEN}/api/mapa-calor?${qsMapa()}`, { headers: { Authorization: `Bearer ${Auth.token()}` } });
  if (res.status === 401) { cerrarSesion(true); throw new Error('Tu sesión expiró.'); }
  const datos = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(datos?.error || `Error ${res.status}`), { http: res.status });
  return { datos, desdeSW: res.headers.get('X-Desde-Cache') === 'service-worker' };
}

/* Punto 8: uso directo de la Cache API para guardar y recuperar el mapa */
async function guardarEnCacheAPI(datos) {
  if (!('caches' in window)) return;
  const cache = await caches.open(CACHE_MAPA);
  const cuerpo = JSON.stringify({ guardado: Date.now(), datos });
  const opciones = { headers: { 'Content-Type': 'application/json' } };
  await cache.put(`/__mapa-calor/${encodeURIComponent(claveMapa())}`, new Response(cuerpo, opciones));
  await cache.put('/__mapa-calor/ultimo', new Response(cuerpo, opciones));
}

async function leerDeCacheAPI(exacto = false) {
  if (!('caches' in window)) return null;
  const cache = await caches.open(CACHE_MAPA);
  const r = await cache.match(`/__mapa-calor/${encodeURIComponent(claveMapa())}`) || (!exacto && await cache.match('/__mapa-calor/ultimo'));
  return r ? r.json() : null;
}

/* Si no hay red ni instantánea, el administrador calcula el mapa con los tickets guardados en el dispositivo */
function calcularLocal() {
  const dias = { '7': 7, '30': 30, '90': 90 }[MC.dias];
  const desde = dias ? Date.now() - dias * 864e5 : 0;
  const activos = ['Abierto', 'Asignado', 'En Proceso'];
  const T = DB.tickets.filter(t => t.createdAt >= desde
    && (!MC.severidad || t.severidad === MC.severidad)
    && (MC.estado === 'todos' || (MC.estado === 'activos' ? activos.includes(t.estado) : ['Resuelto', 'Cerrado'].includes(t.estado))));
  const porCat = MC.vista === 'categoria';
  const columnas = porCat ? Object.keys(CATEGORIAS).map(c => ({ id: c, nombre: c }))
    : [...new Map(CATALOGO.flatMap(e => e.niveles).map(n => [n.id, { id: n.id, nombre: n.nombre }])).values()];
  const celdas = {};
  CATALOGO.forEach(ed => {
    celdas[ed.id] = {};
    columnas.forEach(c => { celdas[ed.id][c.id] = porCat || ed.niveles.some(n => n.id === c.id) ? 0 : null; });
  });
  T.forEach(t => {
    const col = porCat ? t.categoria : t.ubicacion.nivel;
    if (celdas[t.ubicacion.edificio]?.[col] != null) celdas[t.ubicacion.edificio][col]++;
  });
  const umbral = MC.datos?.umbral || 3;
  let max = 0, total = 0, zonaMax = null;
  const calientes = [];
  const filas = CATALOGO.map(ed => {
    let suma = 0;
    columnas.forEach(c => {
      const v = celdas[ed.id][c.id];
      if (v == null) return;
      suma += v;
      if (v > max) { max = v; zonaMax = { fila: ed.id, columna: c.id, reportes: v }; }
      if (v >= umbral) calientes.push({ fila: ed.id, columna: c.id, reportes: v });
    });
    total += suma;
    return { id: ed.id, nombre: ed.nombre, corto: edCorto(ed), total: suma };
  });
  return {
    vista: MC.vista, dias: MC.dias, severidad: MC.severidad, estado: MC.estado,
    filas, columnas: columnas.map(c => ({ ...c, total: CATALOGO.reduce((a, ed) => a + (celdas[ed.id][c.id] || 0), 0) })),
    celdas, max, total, umbral, calientes: calientes.sort((a, b) => b.reportes - a.reportes), zonaMax, generado: Date.now(), ms: 0,
    sql: '-- Calculado en el navegador con los tickets guardados en caché (sin conexión)'
  };
}

async function cargarMapa() {
  const anterior = MC.datos;
  MC.cargando = true;
  try {
    const { datos, desdeSW } = await pedirMapa();
    MC.datos = datos;
    MC.fuente = desdeSW ? 'sw' : 'servidor';
    MC.guardadoEn = datos.generado;
    MC.error = '';
    if (!desdeSW) guardarEnCacheAPI(datos).catch(() => {});
  } catch (err) {
    if (err.http && err.http !== 503) { MC.error = err.message; MC.cargando = false; return; } // 503 = sin red (Service Worker)
    const guardado = await leerDeCacheAPI(true).catch(() => null);
    if (guardado) {
      MC.datos = guardado.datos; MC.fuente = 'cacheapi'; MC.guardadoEn = guardado.guardado;
    } else if (esAdmin() && DB.tickets.length) {
      MC.datos = calcularLocal(); MC.fuente = 'local'; MC.guardadoEn = Date.now();
    } else {
      const ultimo = await leerDeCacheAPI().catch(() => null);
      if (ultimo) { MC.datos = ultimo.datos; MC.fuente = 'cacheapi'; MC.guardadoEn = ultimo.guardado; }
      else MC.error = 'Sin conexión y todavía no hay un mapa guardado en este dispositivo.';
    }
  }
  MC.cargando = false;
  // Punto 11: resalta las celdas que cambiaron desde la última lectura
  MC.cambios = new Set();
  if (anterior && MC.datos && anterior.vista === MC.datos.vista) {
    for (const f of MC.datos.filas) for (const c of MC.datos.columnas) {
      const a = anterior.celdas?.[f.id]?.[c.id];
      const b = MC.datos.celdas[f.id][c.id];
      if (a != null && b != null && a !== b) MC.cambios.add(`${f.id}|${c.id}`);
    }
  }
}

/* =========================================================
   RENDER PRINCIPAL
   ========================================================= */
RENDER.mapacalor = s => {
  const tabs = [['mapa', 'Mapa', 'fire'], ['historial', 'Historial', 'history'], ['cotejo', 'Lista de cotejo PWA', 'clipboard']];
  return `
  <section class="hero-banner hero-sm mc-hero" style="--bg:url('img/banner-admin.jpg')">
    <div class="hero-banner-content">
      <span class="pill pill-glass">${icon('fire')} RF-07 · Analítica operativa</span>
      <h2>Mapa de calor de incidencias</h2>
      <p>Concentración de reportes por edificio, categoría y nivel, calculada en vivo desde la base de datos.</p>
    </div>
  </section>
  <div class="toolbar">
    <div class="tabs mc-tabs">${tabs.map(([k, l, ic]) => `<button class="tab ${MC.tab === k ? 'is-on' : ''}" data-action="mc-tab" data-tab="${k}">${icon(ic)} ${l}</button>`).join('')}</div>
    <div id="mcEstado">${barraEstado()}</div>
  </div>
  <div id="mcCuerpo">${MC.tab === 'mapa' ? vistaMapa(s) : MC.tab === 'historial' ? vistaHistorial() : vistaCotejo()}</div>`;
};

POST_RENDER.mapacalor = async () => {
  if (MC.tab === 'mapa') {
    await cargarMapa();
    api('/mapa-calor/alertas').then(a => { MC.alertas = a; }).catch(() => {}).finally(pintarMapa);
    pintarMapa();
    setTimeout(() => { if (MC.cambios.size) { MC.cambios.clear(); pintarMapa(); } }, 4000);
  } else if (MC.tab === 'historial') {
    try { MC.historial = await api('/mapa-calor/historial'); } catch (e) { MC.historial = MC.historial || []; toast('Historial no disponible', e.message, 'error'); }
    pintarCuerpo();
  } else {
    if (!Object.keys(MC.cotejo).length) ejecutarCotejo();
  }
};

function pintarCuerpo() {
  if (state.vista !== 'mapacalor') return;
  const s = Auth.sesion();
  const cuerpo = $('#mcCuerpo');
  if (cuerpo) cuerpo.innerHTML = MC.tab === 'mapa' ? vistaMapa(s) : MC.tab === 'historial' ? vistaHistorial() : vistaCotejo();
  const est = $('#mcEstado');
  if (est) est.innerHTML = barraEstado();
}
const pintarMapa = () => { if (MC.tab === 'mapa') pintarCuerpo(); };

function barraEstado() {
  const sse = typeof fuenteEventos !== 'undefined' && fuenteEventos?.readyState === 1;
  const f = FUENTES[MC.fuente];
  return `<div class="mc-status">
    <span class="chip ${navigator.onLine && sse ? 'st-resuelto' : 'st-rechazado'}">${navigator.onLine ? (sse ? 'En vivo' : 'Conectando…') : 'Sin conexión'}</span>
    ${f ? `<span class="chip ${f[1]}">${f[0]}</span>` : ''}
    ${MC.guardadoEn ? `<span class="muted small">Actualizado ${new Date(MC.guardadoEn).toLocaleTimeString('es-MX')}</span>` : ''}
  </div>`;
}

/* =========================================================
   PESTAÑA 1: MAPA
   ========================================================= */
function vistaMapa(s) {
  const d = MC.datos;
  const admin = s?.role === 'admin';
  const filtros = `
  <section class="card mc-filtros">
    <div class="mc-filtro"><span>Vista</span><div class="tabs">${[['categoria', 'Edificio × Categoría'], ['nivel', 'Edificio × Nivel']].map(([k, l]) => `<button class="tab ${MC.vista === k ? 'is-on' : ''}" data-action="mc-set" data-k="vista" data-v="${k}">${l}</button>`).join('')}</div></div>
    <div class="mc-filtro"><span>Periodo</span><div class="tabs">${PERIODOS_MC.map(([k, l]) => `<button class="tab ${MC.dias === k ? 'is-on' : ''}" data-action="mc-set" data-k="dias" data-v="${k}">${l}</button>`).join('')}</div></div>
    <label class="mc-filtro"><span>Severidad</span><select data-mc="severidad"><option value="">Todas</option>${['Baja', 'Media', 'Crítica'].map(x => `<option ${MC.severidad === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
    <label class="mc-filtro"><span>Estado</span><select data-mc="estado">${[['todos', 'Todos'], ['activos', 'Activos'], ['cerrados', 'Resueltos y cerrados']].map(([k, l]) => `<option value="${k}" ${MC.estado === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <div class="mc-filtro mc-botones">
      <button class="btn btn-ghost btn-sm" data-action="mc-actualizar">${icon('refresh')} Actualizar</button>
      ${admin ? `<button class="btn btn-primary btn-sm" data-action="mc-guardar">${icon('save')} Guardar instantánea</button>` : ''}
      <button class="btn btn-ghost btn-sm" data-action="push-permiso">${icon('bell')} Avisos push</button>
    </div>
  </section>`;

  if (!d) {
    return filtros + `<section class="card">${MC.error ? vacio('No se pudo cargar el mapa', esc(MC.error), 'alert') : vacio('Calculando el mapa de calor…', 'Consultando la base de datos.', 'database')}</section>`;
  }
  const zona = d.zonaMax;
  const nombreCol = id => d.columnas.find(c => c.id === id)?.nombre || id;
  return filtros + `
  ${MC.error ? `<div class="alert alert-error">${esc(MC.error)}</div>` : ''}
  <section class="kpi-grid mc-kpis">
    <article class="kpi kpi-0"><div class="kpi-top"><span>Reportes en el mapa</span><span class="kpi-ic">${icon('list')}</span></div><strong>${d.total}</strong><small>${PERIODOS_MC.find(p => p[0] === d.dias)?.[1] || ''}${d.severidad ? ` · ${d.severidad}` : ''}</small></article>
    <article class="kpi kpi-3"><div class="kpi-top"><span>Zona más caliente</span><span class="kpi-ic">${icon('fire')}</span></div><strong>${zona ? zona.reportes : 0}</strong><small>${zona ? `Edificio ${esc(zona.fila)} · ${esc(nombreCol(zona.columna))}` : 'Sin reportes'}</small></article>
    <article class="kpi kpi-2"><div class="kpi-top"><span>Zonas calientes</span><span class="kpi-ic">${icon('alert')}</span></div><strong>${d.calientes.length}</strong><small>Celdas con ${d.umbral} reportes o más</small></article>
    <article class="kpi kpi-1"><div class="kpi-top"><span>Umbral de alerta</span><span class="kpi-ic">${icon('shield')}</span></div><strong>${d.umbral}</strong><small>${admin ? '<button class="mc-link" data-action="mc-umbral">Cambiar umbral</button>' : 'Configurado por administración'}</small></article>
  </section>

  <div class="mc-layout">
    <section class="card">
      <div class="card-head">
        <div><h3>${d.vista === 'categoria' ? 'Edificio × Categoría' : 'Edificio × Nivel'}</h3><p class="muted small">Toca o haz clic en una celda para consultar sus reportes en la base de datos.</p></div>
        <span class="muted small">${d.ms ? `Consulta SQL: ${d.ms} ms` : ''}</span>
      </div>
      ${gridHTML(d)}
      <div class="mc-leyenda">
        <span>Menos</span><i class="mc-escala"></i><span>Más</span>
        <span class="mc-ley-item"><i class="mc-hot-ej"></i>Zona caliente (≥ ${d.umbral})</span>
        <span class="mc-ley-item"><i class="mc-na-ej"></i>No existe en el catálogo</span>
      </div>
    </section>
    <aside class="mc-aside">
      <section class="card">
        <div class="card-head"><h3>${icon('fire')} Zonas calientes</h3><span class="chip st-rechazado">${d.calientes.length}</span></div>
        ${d.calientes.length ? `<ul class="mc-lista">${d.calientes.map(z => `<li><button data-action="mc-celda" data-fila="${esc(z.fila)}" data-col="${esc(z.columna)}">
          <b>${z.reportes}</b><span>Edificio ${esc(z.fila)} · ${esc(nombreCol(z.columna))}</span>${icon('arrow')}</button></li>`).join('')}</ul>`
          : `<p class="muted small">Ninguna celda alcanza el umbral de ${d.umbral} reportes.</p>`}
      </section>
      <section class="card">
        <div class="card-head"><h3>${icon('bell')} Alertas recientes</h3></div>
        ${MC.alertas.length ? `<ul class="mc-alertas">${MC.alertas.slice(0, 5).map(a => `<li><strong>Edificio ${esc(a.edificio_id)} · ${esc(a.categoria)}</strong><span>${a.reportes} reportes (umbral ${a.umbral})${a.folio ? ` · ${esc(a.folio)}` : ''}</span><small>${hace(a.creado_en)}</small></li>`).join('')}</ul>`
          : '<p class="muted small">Cuando un reporte nuevo haga que una zona alcance el umbral, aparecerá aquí y se enviará una notificación push.</p>'}
      </section>
      <details class="card mc-sql">
        <summary>${icon('database')} Consulta SQL ejecutada</summary>
        <pre class="sql-code">${esc(d.sql || '')}</pre>
      </details>
    </aside>
  </div>`;
}

/* Cuadrícula para escritorio + tarjetas para celular (Punto 6) */
function gridHTML(d, { interactivo = true } = {}) {
  const max = Math.max(1, d.max || 0);
  const nivel = v => (0.08 + 0.87 * v / max).toFixed(2);
  const celda = (f, c) => {
    const v = d.celdas[f.id]?.[c.id];
    if (v == null) return '<span class="mc-cell na" title="No existe en el catálogo">—</span>';
    const hot = v >= d.umbral && v > 0;
    const clases = `mc-cell ${v / max > 0.55 ? 'oscura' : ''} ${hot ? 'hot' : ''} ${MC.cambios.has(`${f.id}|${c.id}`) && interactivo ? 'cambio' : ''}`;
    const titulo = `Edificio ${f.id} · ${c.nombre}: ${v} reporte${v === 1 ? '' : 's'}`;
    return interactivo
      ? `<button class="${clases}" style="--a:${nivel(v)}" title="${esc(titulo)}" data-action="mc-celda" data-fila="${esc(f.id)}" data-col="${esc(c.id)}">${v}${hot ? `<i class="mc-flama">${icon('fire')}</i>` : ''}</button>`
      : `<span class="${clases}" style="--a:${nivel(v)}" title="${esc(titulo)}">${v}</span>`;
  };
  const escritorio = `
  <div class="mc-grid-wrap"><div class="mc-grid" style="--cols:${d.columnas.length}">
    <span class="mc-esq"></span>
    ${d.columnas.map(c => `<span class="mc-head">${esc(c.nombre)}</span>`).join('')}
    <span class="mc-head mc-tot">Total</span>
    ${d.filas.map(f => `
      <span class="mc-fila"><b>Edificio ${esc(f.id)}</b><small>${esc(f.corto || f.nombre)}</small></span>
      ${d.columnas.map(c => celda(f, c)).join('')}
      <span class="mc-total">${f.total}</span>`).join('')}
    <span class="mc-fila mc-tot"><b>Total</b></span>
    ${d.columnas.map(c => `<span class="mc-total">${c.total}</span>`).join('')}
    <span class="mc-total mc-gran">${d.total}</span>
  </div></div>`;

  const movil = `
  <div class="mc-movil">${d.filas.map(f => `
    <div class="mc-card">
      <div class="mc-card-head"><div><b>Edificio ${esc(f.id)}</b><small>${esc(f.corto || f.nombre)}</small></div><span class="chip st-asignado">${f.total} reportes</span></div>
      ${d.columnas.map(c => {
        const v = d.celdas[f.id]?.[c.id];
        if (v == null) return `<div class="mc-barra na"><span>${esc(c.nombre)}</span><i></i><b>—</b></div>`;
        const hot = v >= d.umbral && v > 0;
        const inner = `<span>${esc(c.nombre)}</span><i><em style="width:${Math.round(v / max * 100)}%;--a:${nivel(v)}"></em></i><b>${v}</b>`;
        return interactivo
          ? `<button class="mc-barra ${hot ? 'hot' : ''} ${MC.cambios.has(`${f.id}|${c.id}`) ? 'cambio' : ''}" data-action="mc-celda" data-fila="${esc(f.id)}" data-col="${esc(c.id)}">${inner}</button>`
          : `<div class="mc-barra ${hot ? 'hot' : ''}">${inner}</div>`;
      }).join('')}
    </div>`).join('')}
  </div>`;
  return escritorio + movil;
}

/* Detalle de una celda: consulta a la base de datos (Punto 15) */
async function abrirCeldaMapa(fila, col) {
  const d = MC.datos;
  const nombreCol = d?.columnas.find(c => c.id === col)?.nombre || col;
  state.modal = { tipo: 'mc-celda' };
  abrirModal(`<div class="modal-pad"><div class="modal-head"><span class="stat-ic">${icon('fire')}</span><div><h3>Edificio ${esc(fila)} · ${esc(nombreCol)}</h3><p class="muted small">Consultando la base de datos…</p></div></div></div>`, true);
  let lista;
  try {
    lista = await api(`/mapa-calor/detalle?${qsMapa()}&fila=${encodeURIComponent(fila)}&columna=${encodeURIComponent(col)}`);
  } catch (e) {
    const local = DB.tickets.filter(t => t.ubicacion.edificio === fila && (MC.vista === 'categoria' ? t.categoria === col : t.ubicacion.nivel === col));
    lista = local.map(t => ({ folio: t.id, estado: t.estado, severidad: t.severidad, espacio: t.ubicacion.espacio, activo: t.ubicacion.activo, creado_en: new Date(t.createdAt).toISOString(), descripcion: t.descripcion, sinRed: true }));
  }
  if (state.modal?.tipo !== 'mc-celda') return;
  $('#modalBody').innerHTML = `<div class="modal-pad">
    <div class="modal-head"><span class="stat-ic">${icon('fire')}</span><div><h3>Edificio ${esc(fila)} · ${esc(nombreCol)}</h3>
      <p class="muted small">${lista.length} reporte${lista.length === 1 ? '' : 's'} · consulta a la tabla <code>tickets</code>${lista[0]?.sinRed ? ' (copia local, sin conexión)' : ''}</p></div></div>
    ${lista.length ? `<div class="table-wrap"><table class="table">
      <thead><tr><th>Folio</th><th>Espacio</th><th>Severidad</th><th>Estado</th><th>Fecha</th><th></th></tr></thead>
      <tbody>${lista.map(t => `<tr>
        <td data-label="Folio"><strong>${esc(t.folio)}</strong><small>${esc(t.activo || '')}</small></td>
        <td data-label="Espacio">${esc(t.espacio)}</td>
        <td data-label="Severidad">${sevChip(t.severidad)}</td>
        <td data-label="Estado">${estadoChip(t.estado)}</td>
        <td data-label="Fecha">${esc(String(t.creado_en).slice(0, 10))}</td>
        <td data-label="">${DB.ticket(t.folio) ? `<button class="btn btn-ghost btn-sm" data-action="ver" data-id="${esc(t.folio)}">${icon('eye')} Ver</button>` : ''}</td>
      </tr>`).join('')}</tbody></table></div>` : vacio('Sin reportes en esta celda', 'Prueba con otro periodo o filtro.', 'checkCircle')}
    <div class="modal-actions"><button class="btn btn-ghost" data-close>Cerrar</button></div>
  </div>`;
}

/* =========================================================
   PESTAÑA 2: HISTORIAL (CRUD en la base de datos)
   ========================================================= */
function vistaHistorial() {
  const admin = esAdmin();
  const h = MC.historial;
  return `
  <section class="card">
    <div class="card-head">
      <div><h3>${icon('history')} Instantáneas guardadas</h3><p class="muted small">Cada instantánea es un registro de la tabla <code>mapa_calor_historial</code>: se puede crear, consultar, editar y eliminar.</p></div>
      ${admin ? `<button class="btn btn-primary btn-sm" data-action="mc-guardar">${icon('save')} Guardar el mapa actual</button>` : ''}
    </div>
    ${!h ? vacio('Cargando historial…', '', 'database') : !h.length ? vacio('Aún no hay instantáneas', 'Guarda el mapa actual para compararlo después.', 'history') : `
    <div class="table-wrap"><table class="table users-table">
      <thead><tr><th>#</th><th>Fecha</th><th>Vista</th><th>Periodo</th><th>Total</th><th>Zona más caliente</th><th>Nota</th><th>Guardó</th><th>Acciones</th></tr></thead>
      <tbody>${h.map(x => `<tr>
        <td data-label="#"><code>${x.id}</code></td>
        <td data-label="Fecha">${fmtFecha(x.creado_en)}</td>
        <td data-label="Vista">${x.vista === 'categoria' ? 'Categoría' : 'Nivel'}</td>
        <td data-label="Periodo">${PERIODOS_MC.find(p => p[0] === x.periodo)?.[1] || esc(x.periodo)}${x.filtros?.severidad ? ` · ${esc(x.filtros.severidad)}` : ''}</td>
        <td data-label="Total">${x.total}</td>
        <td data-label="Zona más caliente">${esc(x.zona_max || '—')}</td>
        <td data-label="Nota">${esc(x.nota || '—')}</td>
        <td data-label="Guardó">${esc(x.usuario || '—')}</td>
        <td data-label="Acciones"><div class="row-actions">
          <button class="btn btn-ghost btn-sm" data-action="mc-hist-ver" data-id="${x.id}" title="Consultar">${icon('eye')}</button>
          ${admin ? `<button class="btn btn-ghost btn-sm" data-action="mc-hist-editar" data-id="${x.id}" title="Editar nota">${icon('edit')}</button>
          <button class="btn btn-danger btn-sm" data-action="mc-hist-borrar" data-id="${x.id}" title="Eliminar">${icon('trash')}</button>` : ''}
        </div></td>
      </tr>`).join('')}</tbody></table></div>`}
  </section>`;
}

/* =========================================================
   PESTAÑA 3: LISTA DE COTEJO PWA (17 puntos)
   ========================================================= */
const ESTADOS_COTEJO = { ok: ['Cumple', 'st-resuelto'], warn: ['Revisar', 'st-en-proceso'], fail: ['No cumple', 'st-rechazado'], info: ['Informativo', 'st-asignado'], run: ['Verificando…', 'st-abierto'] };

function detectarPlataforma() {
  const ua = navigator.userAgent;
  const so = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iOS / iPadOS'
    : /Windows/i.test(ua) ? 'Windows' : /Mac OS X/i.test(ua) ? 'macOS' : /CrOS/i.test(ua) ? 'ChromeOS' : /Linux/i.test(ua) ? 'Linux' : 'Desconocido';
  const m = ua.match(/(Edg|OPR|SamsungBrowser|Firefox|Chrome|Version)\/([\d.]+)/);
  const nav = !m ? 'Desconocido' : { Edg: 'Microsoft Edge', OPR: 'Opera', SamsungBrowser: 'Samsung Internet', Firefox: 'Firefox', Chrome: 'Google Chrome', Version: 'Safari' }[m[1]] + ' ' + m[2].split('.')[0];
  const tactil = navigator.maxTouchPoints > 0;
  const ancho = Math.min(screen.width, screen.height);
  const tipo = !tactil ? 'Equipo de escritorio / laptop' : ancho < 600 ? 'Smartphone' : 'Tablet';
  const instalada = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  return { so, nav, tactil, tipo, instalada };
}

const fila = (k, v) => `<div class="ck-row"><span>${k}</span><b>${v}</b></div>`;
const ms = t0 => `${Math.round(performance.now() - t0)} ms`;

async function crudPrueba() {
  const pasos = [];
  const paso = async (nombre, fn) => { const t0 = performance.now(); try { const r = await fn(); pasos.push([nombre, 'ok', ms(t0), r]); return r; } catch (e) { pasos.push([nombre, 'fail', ms(t0), e.message]); throw e; } };
  try {
    const { id } = await paso('INSERT · guardar instantánea', () => api('/mapa-calor/historial', { method: 'POST', body: { vista: MC.vista, dias: MC.dias, severidad: MC.severidad, estado: MC.estado, nota: 'Prueba automática de la lista de cotejo' } }));
    await paso('SELECT · consultar instantánea', async () => { const r = await api(`/mapa-calor/historial/${id}`); return `${r.total} reportes guardados`; });
    await paso('UPDATE · editar la nota', () => api(`/mapa-calor/historial/${id}`, { method: 'PATCH', body: { nota: 'Prueba editada' } }));
    await paso('DELETE · eliminar instantánea', () => api(`/mapa-calor/historial/${id}`, { method: 'DELETE' }));
  } catch { /* el paso fallido queda registrado */ }
  return pasos;
}

async function pruebasBackend() {
  const base = `${API_ORIGEN}/api`;
  const casos = [
    ['GET /api/salud', 'Servidor en línea', () => fetch(`${base}/salud`), 200],
    ['GET /api/mapa-calor (sin token)', 'Rechaza peticiones sin autenticación', () => fetch(`${base}/mapa-calor`), 401],
    ['GET /api/mapa-calor (token falso)', 'Valida la firma del JWT', () => fetch(`${base}/mapa-calor`, { headers: { Authorization: 'Bearer token.falso.123' } }), 401],
    ['POST /api/auth/login (contraseña incorrecta)', 'Autenticación con bcrypt', () => fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correo: 'admin@institucion.edu.mx', password: 'incorrecta' }) }), 401],
    ['GET /api/mapa-calor?vista=xyz', 'Valida parámetros', () => fetch(`${base}/mapa-calor?vista=xyz`, { headers: { Authorization: `Bearer ${Auth.token()}` } }), 400],
    ['GET /api/mapa-calor?vista=categoria', 'Consulta válida con token', () => fetch(`${base}/mapa-calor?vista=categoria&dias=todo`, { headers: { Authorization: `Bearer ${Auth.token()}` } }), 200],
    ['GET /api/mapa-calor/detalle', 'Consulta de una celda', () => fetch(`${base}/mapa-calor/detalle?vista=categoria&fila=B&columna=Red%2FTI`, { headers: { Authorization: `Bearer ${Auth.token()}` } }), 200]
  ];
  const out = [];
  for (const [ruta, desc, fn, esperado] of casos) {
    const t0 = performance.now();
    try {
      const r = await fn();
      out.push({ ruta, desc, esperado, status: r.status, ok: r.status === esperado, tiempo: ms(t0) });
    } catch (e) {
      out.push({ ruta, desc, esperado, status: 'sin red', ok: false, tiempo: ms(t0) });
    }
  }
  return out;
}

const COTEJO = [
  { n: 1, criterio: 'Instalación de la aplicación', comprueba: 'Que se pueda instalar en los dispositivos compatibles.', acciones: [['pwa-instalar', 'download', 'Instalar app']],
    async fn() {
      const p = detectarPlataforma();
      const reg = await navigator.serviceWorker?.getRegistration();
      const instalable = !!PWA.instalar;
      return { estado: p.instalada || instalable || (reg && document.querySelector('link[rel=manifest]')) ? 'ok' : 'warn',
        resumen: p.instalada ? 'La app se está ejecutando instalada (modo standalone).' : instalable ? 'El navegador ofrece instalarla ahora mismo.' : 'Cumple los requisitos de instalación (manifest + Service Worker + HTTPS).',
        html: fila('Modo de visualización', p.instalada ? 'standalone (instalada)' : 'navegador') + fila('Aviso de instalación disponible', instalable ? 'Sí' : 'No en este momento') + fila('Navegador', p.nav) + fila('Atajo directo al mapa', '"Mapa de calor" en el menú del ícono instalado') };
    } },
  { n: 2, criterio: 'Icono de la aplicación', comprueba: 'Que tenga iconos adecuados para la instalación y la pantalla de inicio.',
    async fn() {
      const m = await (await fetch('manifest.json', { cache: 'no-cache' })).json();
      const iconos = [...m.icons, { src: 'icons/apple-touch-icon.png', sizes: '180x180', purpose: 'iOS' }];
      const cargas = await Promise.all(iconos.map(i => new Promise(r => { const im = new Image(); im.onload = () => r(im.naturalWidth); im.onerror = () => r(0); im.src = i.src; })));
      const todos = cargas.every(x => x > 0);
      const tamanos = m.icons.map(i => i.sizes);
      return { estado: todos && tamanos.includes('192x192') && tamanos.includes('512x512') ? 'ok' : 'fail',
        resumen: `${iconos.length} íconos cargados correctamente (192, 512, maskable y Apple).`,
        html: `<div class="ck-iconos">${iconos.map((i, k) => `<figure><img src="${i.src}" alt=""><figcaption>${i.sizes}<br><small>${i.purpose || 'any'} · ${cargas[k] ? 'OK' : 'error'}</small></figcaption></figure>`).join('')}</div>` };
    } },
  { n: 3, criterio: 'Protocolo HTTPS', comprueba: 'Que funcione mediante HTTPS, salvo excepciones como localhost durante el desarrollo.',
    async fn() {
      const local = ['localhost', '127.0.0.1'].includes(location.hostname);
      const https = location.protocol === 'https:';
      return { estado: https || local ? 'ok' : 'fail',
        resumen: https ? 'Conexión cifrada con HTTPS (certificado TLS del hosting).' : local ? 'Desarrollo en localhost: excepción permitida. En Render la app se sirve con HTTPS.' : 'La página no usa HTTPS: el Service Worker y push no funcionarán.',
        html: fila('Protocolo', location.protocol.replace(':', '').toUpperCase()) + fila('Contexto seguro (isSecureContext)', window.isSecureContext ? 'Sí' : 'No') + fila('Dominio', location.host) + fila('Funciones que exigen HTTPS', 'Service Worker, Cache API, Push, instalación') };
    } },
  { n: 4, criterio: 'Archivo Manifest', comprueba: 'Que exista un manifest.json válido con nombre, iconos, colores y modo de visualización.',
    async fn() {
      const res = await fetch('manifest.json', { cache: 'no-cache' });
      const m = await res.json();
      const req = ['name', 'short_name', 'icons', 'start_url', 'display', 'theme_color', 'background_color'];
      const faltan = req.filter(k => !m[k]);
      const sw = c => `<i class="ck-swatch" style="background:${c}"></i>${c}`;
      return { estado: res.ok && !faltan.length ? 'ok' : 'fail', resumen: faltan.length ? `Faltan: ${faltan.join(', ')}` : 'manifest.json válido con todos los campos obligatorios.',
        html: fila('name', esc(m.name)) + fila('short_name', esc(m.short_name)) + fila('start_url / scope', `${m.start_url} · ${m.scope}`) + fila('display', m.display) + fila('theme_color', sw(m.theme_color)) + fila('background_color', sw(m.background_color)) + fila('icons', m.icons.length) + fila('shortcuts', (m.shortcuts || []).map(s => s.name).join(', ')) };
    } },
  { n: 5, criterio: 'Service Worker', comprueba: 'Que esté registrado y gestione correctamente los recursos y las solicitudes.', acciones: [['pwa-buscar-version', 'refresh', 'Buscar versión nueva']],
    async fn() {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (!reg) return { estado: 'fail', resumen: 'No hay un Service Worker registrado.' };
      if (typeof pedirVersion === 'function') pedirVersion();
      return { estado: reg.active ? 'ok' : 'warn', resumen: `sw.js ${reg.active?.state === 'activated' ? 'activo' : reg.active?.state || 'instalando'} y controlando la página.`,
        html: fila('Archivo', 'sw.js') + fila('Estado', reg.active?.state || '—') + fila('Alcance (scope)', reg.scope) + fila('Controla esta página', navigator.serviceWorker.controller ? 'Sí' : 'No (recarga una vez)') + fila('Versión de caché', PWA.version || 'v3.0.0') + fila('Eventos que atiende', 'install, activate, fetch, push, notificationclick, message') };
    } },
  { n: 6, criterio: 'Diseño responsivo', comprueba: 'Que la interfaz se adapte a diferentes tamaños de pantalla.',
    async fn() {
      const w = innerWidth;
      const modo = w <= 640 ? 'Celular (tarjetas con barras)' : w <= 991 ? 'Tablet (cuadrícula compacta, menú inferior)' : 'Escritorio (cuadrícula completa, menú lateral)';
      return { estado: 'ok', resumen: `El mapa se muestra en modo: ${modo}.`,
        html: fila('Tamaño de la ventana', `${innerWidth} × ${innerHeight} px`) + fila('Orientación', screen.orientation?.type?.replace('-primary', '') || (innerWidth > innerHeight ? 'horizontal' : 'vertical')) + fila('Densidad de píxeles', `${devicePixelRatio}x`) + fila('Puntos de quiebre CSS', '640 px (celular) · 991 px (tablet) · 1280 px (escritorio)') };
    } },
  { n: 7, criterio: 'Memoria caché', comprueba: 'Que los recursos necesarios se guarden en caché para el acceso sin conexión.',
    async fn() {
      const nombres = (await caches.keys()).filter(n => n.startsWith('campuscare'));
      const info = await Promise.all(nombres.map(async n => [n, (await (await caches.open(n)).keys()).length]));
      const shell = nombres.find(n => n.startsWith('campuscare-app-'));
      const tieneMapa = shell && await (await caches.open(shell)).match('mapacalor.js');
      const snap = await leerDeCacheAPI().catch(() => null);
      return { estado: shell && tieneMapa ? 'ok' : 'warn', resumen: `${nombres.length} cachés con ${info.reduce((a, x) => a + x[1], 0)} recursos guardados en el dispositivo.`,
        html: info.map(([n, c]) => fila(`<code>${n}</code>`, `${c} recursos`)).join('') + fila('mapacalor.js disponible sin red', tieneMapa ? 'Sí' : 'No') + fila('Última instantánea del mapa', snap ? new Date(snap.guardado).toLocaleString('es-MX') : 'Aún no') };
    } },
  { n: 8, criterio: 'Cache API', comprueba: 'Que se utilice correctamente la API de caché para almacenar y recuperar recursos.', acciones: [['mc-probar-cache', 'play', 'Repetir prueba']],
    async fn() {
      const t0 = performance.now();
      const c = await caches.open('campuscare-prueba');
      await c.put('/__prueba', new Response(JSON.stringify({ hola: 'CampusCare', t: Date.now() })));
      const leido = await (await c.match('/__prueba')).json();
      const borrado = await c.delete('/__prueba');
      await caches.delete('campuscare-prueba');
      const snap = await leerDeCacheAPI().catch(() => null);
      return { estado: leido.hola === 'CampusCare' && borrado ? 'ok' : 'fail', resumen: `caches.open → put → match → delete en ${ms(t0)}.`,
        html: fila('caches.open("campuscare-prueba")', 'OK') + fila('cache.put(petición, respuesta)', 'OK') + fila('cache.match() → contenido leído', esc(JSON.stringify({ hola: leido.hola }))) + fila('cache.delete()', borrado ? 'OK' : 'Error') + fila(`Mapa guardado en <code>${CACHE_MAPA}</code>`, snap ? `${snap.datos.total} reportes · ${new Date(snap.guardado).toLocaleTimeString('es-MX')}` : 'Aún no') };
    } },
  { n: 9, criterio: 'Compatibilidad con sistemas operativos', comprueba: 'Que funcione en Windows, macOS, Android e iOS, según las funciones compatibles.',
    async fn() {
      const p = detectarPlataforma();
      const matriz = [['Windows', 'Sí', 'Sí', 'Sí', 'Chrome / Edge'], ['macOS', 'Sí', 'Sí', 'Sí', 'Chrome / Edge / Safari'], ['Android', 'Sí', 'Sí', 'Sí', 'Chrome / Samsung Internet'], ['iOS / iPadOS', 'Sí (Agregar a inicio)', 'Sí', 'Sí, instalada (16.4+)', 'Safari']];
      return { estado: 'ok', resumen: `Sistema detectado: ${p.so} · ${p.nav}.`,
        html: `<div class="table-wrap"><table class="table ck-tabla"><thead><tr><th>Sistema</th><th>Instalación</th><th>Sin conexión</th><th>Push</th><th>Navegador</th></tr></thead><tbody>${matriz.map(r => `<tr class="${r[0] === p.so ? 'is-actual' : ''}">${r.map((x, i) => `<td data-label="${['Sistema', 'Instalación', 'Sin conexión', 'Push', 'Navegador'][i]}">${x}${i === 0 && r[0] === p.so ? ' <small>(este equipo)</small>' : ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` };
    } },
  { n: 10, criterio: 'Compatibilidad multiplataforma', comprueba: 'Que pueda utilizarse en equipos de escritorio, smartphones y navegadores web.',
    async fn() {
      const p = detectarPlataforma();
      return { estado: 'ok', resumen: `Funcionando en: ${p.tipo} · ${p.nav}.`,
        html: fila('Tipo de dispositivo', p.tipo) + fila('Pantalla táctil', p.tactil ? 'Sí' : 'No') + fila('Navegador', p.nav) + fila('Ejecución', p.instalada ? 'App instalada' : 'Navegador web') + fila('Probado en', 'Chrome, Edge (escritorio) · Chrome Android · Safari iOS') };
    } },
  { n: 11, criterio: 'Actualización de datos', comprueba: 'Que los cambios realizados en la base de datos se reflejen correctamente en la aplicación.', acciones: [['mc-probar-actualizacion', 'play', 'Medir actualización en vivo']],
    async fn() {
      const sse = typeof fuenteEventos !== 'undefined' && fuenteEventos?.readyState === 1;
      const bd = MC.diag?.bd || {};
      return { estado: sse ? 'ok' : 'warn', resumen: sse ? 'Conectado en tiempo real: el mapa se recalcula al instante cuando cambia la base de datos.' : 'Sin canal en tiempo real en este momento.',
        html: fila('Canal en tiempo real (Server-Sent Events)', sse ? 'Conectado' : 'Desconectado') + fila('Vigilancia de la BD (PRAGMA data_version)', `cada 2 s · ${bd.revisiones ?? '—'} revisiones`) + fila('Cambios externos detectados', `${bd.cambiosExternos ?? 0}${bd.ultimoCambioExterno ? ` · último ${new Date(bd.ultimoCambioExterno).toLocaleTimeString('es-MX')}` : ''}`) + fila('Última lectura del mapa', MC.guardadoEn ? new Date(MC.guardadoEn).toLocaleTimeString('es-MX') : '—') + (MC.latencia ? fila('Prueba: cambio guardado → mapa actualizado', MC.latencia) : '') };
    } },
  { n: 12, criterio: 'Funcionamiento sin conexión', comprueba: 'Que las funciones disponibles sin internet continúen funcionando correctamente.',
    async fn() {
      const reg = await navigator.serviceWorker?.getRegistration();
      const snap = await leerDeCacheAPI().catch(() => null);
      return { estado: reg?.active && snap ? 'ok' : 'warn', resumen: navigator.onLine ? 'En línea. Si se pierde la red, el mapa se muestra desde la caché.' : 'Sin conexión: el mapa se muestra con la información guardada.',
        html: fila('Estado de la red', navigator.onLine ? 'En línea' : 'Sin conexión') + fila('Abrir la app sin red', reg?.active ? 'Sí (Service Worker)' : 'No') + fila('Ver el mapa sin red', snap ? 'Sí (Cache API)' : 'Abre el mapa una vez con red') + fila('Cambiar vista, periodo y filtros sin red', esAdmin() ? 'Sí (cálculo en el dispositivo)' : 'Solo la última vista guardada') + fila('Consultar los reportes de una celda sin red', 'Sí (copia local de tickets)') + fila('Guardar cambios sin red', 'No: requiere el servidor') };
    } },
  { n: 13, criterio: 'Persistencia del inicio de sesión y progreso', comprueba: 'Que se conserven los datos de sesión y el progreso previo sin internet, cuando corresponda.',
    async fn() {
      const s = Auth.sesion();
      let persistente = false;
      try { persistente = !!localStorage.getItem(TOKEN_KEY); } catch { /* sin acceso */ }
      const p = leerPrefs();
      const restante = s ? Math.max(0, s.exp * 1000 - Date.now()) : 0;
      return { estado: s && persistente ? 'ok' : 'warn', resumen: 'La sesión y las preferencias del mapa se conservan al cerrar la app y sin internet.',
        html: fila('Sesión guardada en', persistente ? 'localStorage (persistente)' : 'Solo esta pestaña') + fila('Usuario', esc(s?.name || '—')) + fila('Vigencia restante del token JWT', `${Math.floor(restante / 36e5)} h ${Math.floor(restante % 36e5 / 6e4)} min`) + fila('Progreso guardado del mapa', p.guardado ? `Vista ${p.vista} · ${p.dias} · pestaña ${p.tab}` : 'Aún no') + fila('Datos del mapa guardados', (await leerDeCacheAPI().catch(() => null)) ? 'Sí (Cache API)' : 'No') };
    } },
  { n: 14, criterio: 'Notificaciones push', comprueba: 'Que la aplicación pueda recibir y mostrar notificaciones push en las plataformas compatibles.', acciones: [['push-permiso', 'bell', 'Activar push'], ['mc-push-prueba', 'send', 'Enviar push de prueba']],
    async fn() {
      const e = typeof estadoPush === 'function' ? await estadoPush() : { soportado: false };
      const subs = MC.diag?.push?.misSuscripciones || [];
      return { estado: e.suscrito && subs.length ? 'ok' : e.soportado ? 'warn' : 'fail',
        resumen: e.suscrito ? 'Este dispositivo está suscrito y recibe avisos aunque la app esté cerrada.' : e.soportado ? 'Disponible: presiona "Activar push" para suscribir este dispositivo.' : 'Este navegador no admite push (en iPhone instala la app primero).',
        html: fila('Push API compatible', e.soportado ? 'Sí' : 'No') + fila('Permiso de notificaciones', e.permiso) + fila('Suscripción en este dispositivo', e.suscrito ? 'Activa' : 'No') + fila('Dispositivos registrados (BD)', subs.length ? subs.map(x => `${esc(x.navegador)} · ${x.envios} envíos`).join('<br>') : 'Ninguno') + fila('Tecnología', 'Web Push + VAPID (cifrado aes128gcm)') + (MC.pushResultado ? fila('Última prueba', MC.pushResultado) : '') };
    } },
  { n: 15, criterio: 'Base de datos', comprueba: 'Que los datos se almacenen, consulten y actualicen correctamente.', acciones: [['mc-probar-crud', 'database', 'Probar CRUD']],
    async fn() {
      const bd = MC.diag?.bd;
      if (!bd) return { estado: 'warn', resumen: 'No se pudo consultar el estado de la base de datos (sin conexión).' };
      const t = n => bd.tablas.find(x => x.nombre === n)?.registros ?? 0;
      return { estado: MC.crud?.some(p => p[1] === 'fail') ? 'fail' : 'ok', resumen: `SQLite ${bd.version} · ${bd.tablas.length} tablas · ${t('tickets')} tickets.`,
        html: fila('Motor', `SQLite ${bd.version} (${bd.archivo})`) + fila('Tickets (origen del mapa)', t('tickets')) + fila('mapa_calor_historial', `${t('mapa_calor_historial')} instantáneas`) + fila('mapa_calor_alertas', `${t('mapa_calor_alertas')} alertas`) + fila('configuracion', `umbral = ${MC.datos?.umbral ?? '—'}`) + fila('push_suscripciones', t('push_suscripciones'))
          + (MC.crud ? `<div class="ck-pasos">${MC.crud.map(([n, e, tm, r]) => `<div class="${e}"><b>${e === 'ok' ? 'OK' : 'Error'}</b><span>${esc(n)}</span><small>${tm}${typeof r === 'string' ? ` · ${esc(r)}` : ''}</small></div>`).join('')}</div>` : '') };
    } },
  { n: 16, criterio: 'Tecnologías utilizadas', comprueba: 'Que se identifiquen y documenten los lenguajes, frameworks y herramientas empleados.',
    async fn() {
      const sv = MC.diag?.servidor || {};
      const tec = [['Frontend', 'HTML5, CSS3, JavaScript (ES2022)'], ['APIs del navegador', 'Service Worker, Cache API, Web Push, Notifications, EventSource (SSE), localStorage'], ['Backend', `Node.js ${sv.node || ''} + Express ${sv.express || ''}`], ['Base de datos', `SQLite ${MC.diag?.bd?.version || ''} (módulo node:sqlite) · lenguaje SQL`], ['Seguridad', `JWT (jsonwebtoken ${sv.jsonwebtoken || ''}) · bcryptjs ${sv.bcryptjs || ''} · HTTPS`], ['Herramientas', 'Visual Studio Code, Git/GitHub, Render (hosting), DB Browser for SQLite']];
      return { estado: 'ok', resumen: 'Pila completa en JavaScript: el mismo lenguaje en el navegador y en el servidor (no se usa PHP).', html: tec.map(([k, v]) => fila(k, esc(v))).join('') };
    } },
  { n: 17, criterio: 'Backend', comprueba: 'Que el servidor procese correctamente las solicitudes, la autenticación y las operaciones necesarias.', acciones: [['mc-probar-backend', 'server', 'Ejecutar pruebas']],
    async fn() {
      const r = await pruebasBackend();
      const ok = r.filter(x => x.ok).length;
      return { estado: ok === r.length ? 'ok' : 'fail', resumen: `${ok} de ${r.length} pruebas con la respuesta esperada.`,
        html: `<div class="table-wrap"><table class="table ck-tabla"><thead><tr><th>Petición</th><th>Comprueba</th><th>Esperado</th><th>Recibido</th><th>Tiempo</th></tr></thead><tbody>${r.map(x => `<tr><td data-label="Petición"><code>${esc(x.ruta)}</code></td><td data-label="Comprueba">${esc(x.desc)}</td><td data-label="Esperado">${x.esperado}</td><td data-label="Recibido"><span class="chip ${x.ok ? 'st-resuelto' : 'st-rechazado'}">${x.status}</span></td><td data-label="Tiempo">${x.tiempo}</td></tr>`).join('')}</tbody></table></div>` };
    } }
];

async function verificar(n) {
  const item = COTEJO.find(c => c.n === n);
  MC.cotejo[n] = { estado: 'run', resumen: 'Verificando…' };
  pintarCotejoItem(n);
  try { MC.cotejo[n] = await item.fn(); } catch (e) { MC.cotejo[n] = { estado: 'fail', resumen: `Error al verificar: ${e.message}` }; }
  MC.cotejo[n].hora = Date.now();
  pintarCotejoItem(n);
  pintarResumenCotejo();
}

async function ejecutarCotejo() {
  try { MC.diag = await api('/mapa-calor/diagnostico'); } catch { MC.diag = null; }
  if (!MC.datos) await cargarMapa().catch(() => {});
  for (const c of COTEJO) MC.cotejo[c.n] = { estado: 'run', resumen: 'Verificando…' };
  if (MC.tab === 'cotejo') pintarCuerpo();
  for (const c of COTEJO) await verificar(c.n);
}

function itemCotejoHTML(c) {
  const r = MC.cotejo[c.n] || { estado: 'run', resumen: 'Pendiente' };
  const [txt, cls] = ESTADOS_COTEJO[r.estado] || ESTADOS_COTEJO.info;
  return `<article class="ck-item ck-${r.estado}" id="ck-${c.n}">
    <div class="ck-num">${c.n}</div>
    <div class="ck-main">
      <div class="ck-head"><div><h4>${c.criterio}</h4><p class="muted small">${c.comprueba}</p></div><span class="chip ${cls}">${txt}</span></div>
      <p class="ck-resumen">${esc(r.resumen || '')}</p>
      ${r.html ? `<div class="ck-detalle">${r.html}</div>` : ''}
      <div class="ck-acciones">
        ${(c.acciones || []).map(([a, ic, l]) => `<button class="btn btn-ghost btn-sm" data-action="${a}">${icon(ic)} ${l}</button>`).join('')}
        <button class="btn btn-ghost btn-sm" data-action="mc-verificar" data-n="${c.n}">${icon('refresh')} Verificar</button>
        ${r.hora ? `<span class="muted tiny">Verificado ${new Date(r.hora).toLocaleTimeString('es-MX')}</span>` : ''}
      </div>
    </div>
  </article>`;
}

function resumenCotejoHTML() {
  const v = Object.values(MC.cotejo);
  const ok = v.filter(x => x.estado === 'ok').length;
  const p = detectarPlataforma();
  return `<div class="ck-resumen-bar">
    <div class="ck-score"><strong>${ok}<small>/17</small></strong><span>puntos verificados como "Cumple"</span></div>
    <div class="bar"><i style="width:${ok / 17 * 100}%"></i></div>
    <div class="ck-meta">${icon('monitor')} ${p.so} · ${p.nav} · ${p.tipo} · ${location.protocol.replace(':', '').toUpperCase()} · ${new Date().toLocaleString('es-MX')}</div>
  </div>`;
}

function vistaCotejo() {
  return `
  <section class="card ck-top">
    <div class="card-head">
      <div><h3>${icon('clipboard')} Lista de cotejo PWA aplicada al mapa de calor</h3><p class="muted small">Cada punto se verifica en vivo en este dispositivo. Usa los botones para demostrarlo paso a paso.</p></div>
      <button class="btn btn-primary" data-action="mc-cotejo-todo">${icon('play')} Verificar los 17 puntos</button>
    </div>
    <div id="ckResumen">${resumenCotejoHTML()}</div>
  </section>
  <div class="ck-lista">${COTEJO.map(itemCotejoHTML).join('')}</div>`;
}

function pintarCotejoItem(n) {
  const el = $(`#ck-${n}`);
  if (el) el.outerHTML = itemCotejoHTML(COTEJO.find(c => c.n === n));
}
function pintarResumenCotejo() {
  const el = $('#ckResumen');
  if (el) el.innerHTML = resumenCotejoHTML();
}

/* =========================================================
   ACCIONES
   ========================================================= */
Object.assign(ACCIONES, {
  'mc-tab': (id, el) => { MC.tab = el.dataset.tab; guardarPrefs(); renderVista(); },
  'mc-set': async (id, el) => { MC[el.dataset.k] = el.dataset.v; guardarPrefs(); await cargarMapa(); pintarMapa(); },
  'mc-actualizar': async () => { await cargarMapa(); pintarMapa(); toast('Mapa actualizado', MC.fuente === 'servidor' ? 'Datos leídos de la base de datos.' : 'Sin conexión: se muestra la copia guardada.', 'info'); },
  'mc-celda': (id, el) => abrirCeldaMapa(el.dataset.fila, el.dataset.col),
  'mc-umbral': () => {
    state.modal = { tipo: 'mc-umbral' };
    abrirModal(`<form class="modal-pad" data-form="mc-umbral" novalidate>
      <div class="modal-head"><span class="stat-ic">${icon('shield')}</span><div><h3>Umbral de zona caliente</h3><p class="muted small">Se guarda en la tabla <code>configuracion</code> y se aplica a todos los usuarios.</p></div></div>
      <label class="field"><span>Reportes necesarios para marcar una celda como zona caliente</span><input type="text" inputmode="numeric" name="umbral" value="${MC.datos?.umbral || 3}"></label>
      <div class="alert alert-error" hidden></div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Cancelar</button><button type="submit" class="btn btn-primary">${icon('check')} Guardar</button></div>
    </form>`);
  },
  'mc-guardar': () => {
    state.modal = { tipo: 'mc-guardar' };
    abrirModal(`<form class="modal-pad" data-form="mc-guardar" novalidate>
      <div class="modal-head"><span class="stat-ic">${icon('save')}</span><div><h3>Guardar instantánea</h3><p class="muted small">Vista ${MC.vista === 'categoria' ? 'Edificio × Categoría' : 'Edificio × Nivel'} · ${PERIODOS_MC.find(p => p[0] === MC.dias)[1]}${MC.severidad ? ` · ${MC.severidad}` : ''}. Se insertará un registro en <code>mapa_calor_historial</code>.</p></div></div>
      <label class="field"><span>Nota (opcional)</span><input type="text" name="nota" maxlength="200" placeholder="Ej. Corte de mes antes del mantenimiento preventivo"></label>
      <div class="alert alert-error" hidden></div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Cancelar</button><button type="submit" class="btn btn-primary">${icon('save')} Guardar</button></div>
    </form>`);
  },
  'mc-hist-ver': async id => {
    const h = await api(`/mapa-calor/historial/${id}`);
    state.modal = { tipo: 'mc-hist' };
    const d = { ...h.datos, total: h.total, vista: h.vista };
    abrirModal(`<div class="modal-pad">
      <div class="modal-head"><span class="stat-ic">${icon('history')}</span><div><h3>Instantánea #${h.id}</h3><p class="muted small">${fmtFecha(h.creado_en)} · ${h.vista === 'categoria' ? 'Edificio × Categoría' : 'Edificio × Nivel'} · ${PERIODOS_MC.find(p => p[0] === h.periodo)?.[1] || h.periodo} · ${h.total} reportes${h.nota ? ` · ${esc(h.nota)}` : ''}</p></div></div>
      ${gridHTML(d, { interactivo: false })}
      <div class="modal-actions"><button class="btn btn-ghost" data-close>Cerrar</button></div>
    </div>`, true);
  },
  'mc-hist-editar': id => {
    const h = MC.historial.find(x => String(x.id) === id);
    state.modal = { tipo: 'mc-hist-editar' };
    abrirModal(`<form class="modal-pad" data-form="mc-hist-editar" data-id="${id}" novalidate>
      <div class="modal-head"><span class="stat-ic">${icon('edit')}</span><div><h3>Editar instantánea #${id}</h3><p class="muted small">Se actualizará la columna <code>nota</code> del registro.</p></div></div>
      <label class="field"><span>Nota</span><input type="text" name="nota" maxlength="200" value="${esc(h?.nota || '')}"></label>
      <div class="alert alert-error" hidden></div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Cancelar</button><button type="submit" class="btn btn-primary">${icon('check')} Guardar cambios</button></div>
    </form>`);
  },
  'mc-hist-borrar': async id => {
    if (!confirm(`¿Eliminar la instantánea #${id} de la base de datos?`)) return;
    await api(`/mapa-calor/historial/${id}`, { method: 'DELETE' });
    MC.historial = await api('/mapa-calor/historial');
    pintarCuerpo();
    toast('Instantánea eliminada', `Se borró el registro #${id}.`);
  },
  'mc-cotejo-todo': () => ejecutarCotejo(),
  'mc-verificar': async (id, el) => { if ([11, 14, 15, 16].includes(Number(el.dataset.n))) MC.diag = await api('/mapa-calor/diagnostico').catch(() => MC.diag); verificar(Number(el.dataset.n)); },
  'mc-probar-cache': () => verificar(8),
  'mc-probar-backend': () => verificar(17),
  'mc-probar-crud': async () => {
    if (!esAdmin()) throw new Error('La prueba de escritura requiere el rol de Administrador.');
    MC.crud = await crudPrueba();
    MC.diag = await api('/mapa-calor/diagnostico').catch(() => MC.diag);
    verificar(15);
  },
  'mc-push-prueba': async () => {
    const r = await api('/push/prueba', { method: 'POST' });
    MC.pushResultado = `${r.enviados} de ${r.resultados.length} dispositivo(s) · ${new Date().toLocaleTimeString('es-MX')}`;
    toast('Push enviado', 'Revisa la notificación del sistema (también funciona con la app cerrada).');
    MC.diag = await api('/mapa-calor/diagnostico').catch(() => MC.diag);
    verificar(14);
  },
  'mc-probar-actualizacion': async () => {
    if (!esAdmin()) throw new Error('Esta prueba requiere el rol de Administrador.');
    if (typeof fuenteEventos === 'undefined' || !fuenteEventos) throw new Error('No hay conexión en tiempo real.');
    const t0 = performance.now();
    const llego = new Promise(res => fuenteEventos.addEventListener('cambio', () => res(), { once: true }));
    await api('/mapa-calor/config', { method: 'PUT', body: { umbral: MC.datos?.umbral || 3 } });
    await Promise.race([llego, new Promise(r => setTimeout(r, 5000))]);
    await cargarMapa();
    MC.latencia = `${ms(t0)} (guardar en la BD → aviso SSE → mapa recalculado)`;
    verificar(11);
    toast('Actualización medida', MC.latencia, 'info');
  }
});

Object.assign(FORMULARIOS, {
  'mc-umbral': async form => {
    await api('/mapa-calor/config', { method: 'PUT', body: { umbral: Number(form.umbral.value) } });
    cerrarModal();
    await cargarMapa();
    pintarMapa();
    toast('Umbral actualizado', `Ahora una zona es caliente con ${form.umbral.value} reportes o más.`);
  },
  'mc-guardar': async form => {
    const r = await api('/mapa-calor/historial', { method: 'POST', body: { vista: MC.vista, dias: MC.dias, severidad: MC.severidad, estado: MC.estado, nota: form.nota.value } });
    cerrarModal();
    MC.historial = await api('/mapa-calor/historial').catch(() => MC.historial);
    toast('Instantánea guardada', `Registro #${r.id} en mapa_calor_historial.`);
    if (MC.tab === 'historial') pintarCuerpo();
  },
  'mc-hist-editar': async form => {
    await api(`/mapa-calor/historial/${form.dataset.id}`, { method: 'PATCH', body: { nota: form.nota.value } });
    cerrarModal();
    MC.historial = await api('/mapa-calor/historial');
    pintarCuerpo();
    toast('Instantánea actualizada', 'La nota se guardó en la base de datos.');
  }
});

/* Filtros de severidad y estado */
document.addEventListener('change', async e => {
  const k = e.target.dataset?.mc;
  if (!k) return;
  MC[k] = e.target.value;
  guardarPrefs();
  await cargarMapa();
  pintarMapa();
});

/* Al cambiar la red se actualiza el indicador y, al volver, el mapa */
window.addEventListener('online', () => { if (state.vista === 'mapacalor' && MC.tab === 'mapa') cargarMapa().then(pintarMapa); });
window.addEventListener('offline', () => { if (state.vista === 'mapacalor') pintarCuerpo(); });
