/* =========================================================
   CampusCare · Gestión de incidencias de infraestructura
   app.js — Frontend conectado a la API (Express + SQLite)

   RF-01 Autenticación institucional + JWT + roles
   RF-02 Levantamiento de incidencia con ubicación jerárquica
   RF-03 Máquina de estados del ticket con trazabilidad
   RF-04 Cierre con evidencia obligatoria
   RF-05 Notificaciones en tiempo real (Server-Sent Events + push del navegador)
   RF-06 Dashboard administrativo con filtros
   RF-07 Métricas: MTTR, % SLA y mapa de calor
   ========================================================= */
'use strict';

/* =========================================================
   1. CONFIGURACIÓN Y CATÁLOGOS
   ========================================================= */
const DOMINIO = '@institucion.edu.mx';
const TOKEN_KEY = 'campuscare_token';
const DEMO_PASSWORD = 'Campus2026';
const HORA = 3600000;

const ROLES = {
  solicitante:   { label: 'Alumno / Docente',          vistas: ['inicio', 'reportar', 'mis-tickets', 'notificaciones'] },
  mantenimiento: { label: 'Personal de Mantenimiento', vistas: ['inicio', 'tareas', 'mapacalor', 'notificaciones'] },
  admin:         { label: 'Administrador',             vistas: ['inicio', 'dashboard', 'mapacalor', 'metricas', 'reportar', 'usuarios', 'catalogo', 'basedatos', 'cache', 'notificaciones'],
                   movil: ['inicio', 'dashboard', 'mapacalor', 'basedatos', 'notificaciones'] }
};

const VISTAS = {
  inicio:          { titulo: 'Inicio',                   corto: 'Inicio',    icono: 'home' },
  reportar:        { titulo: 'Reportar incidencia',      corto: 'Reportar',  icono: 'plus' },
  'mis-tickets':   { titulo: 'Mis reportes',             corto: 'Reportes',  icono: 'list' },
  tareas:          { titulo: 'Órdenes de trabajo',       corto: 'Órdenes',   icono: 'wrench' },
  dashboard:       { titulo: 'Dashboard administrativo', corto: 'Dashboard', icono: 'grid' },
  metricas:        { titulo: 'Métricas y analítica',     corto: 'Métricas',  icono: 'chart' },
  usuarios:        { titulo: 'Usuarios',                 corto: 'Usuarios',  icono: 'users' },
  catalogo:        { titulo: 'Catálogo del campus',      corto: 'Catálogo',  icono: 'building' },
  basedatos:       { titulo: 'Base de datos',            corto: 'BD',        icono: 'database' },
  cache:           { titulo: 'Caché y sin conexión',     corto: 'Caché',     icono: 'layers' },
  mapacalor:       { titulo: 'Mapa de calor',            corto: 'Mapa',      icono: 'fire' },
  notificaciones:  { titulo: 'Notificaciones',           corto: 'Avisos',    icono: 'bell' }
};

/* Catálogos: se cargan desde la base de datos al iniciar sesión */
let USUARIOS = [];
let CATALOGO = [];
let CATEGORIAS = {};
let SEVERIDADES = {
  'Baja':    { sla: 72, desc: 'No impide usar el espacio.' },
  'Media':   { sla: 24, desc: 'Afecta parcialmente las actividades.' },
  'Crítica': { sla: 4,  desc: 'Riesgo para personas o suspende clases.' }
};
const POST_RENDER = {}; // acciones que se ejecutan después de dibujar una vista
const ORDEN_SEV = { 'Crítica': 0, 'Media': 1, 'Baja': 2 };

const ESTADOS = ['Abierto', 'Asignado', 'En Proceso', 'Resuelto', 'Cerrado', 'Rechazado'];
const FLUJO = ['Abierto', 'Asignado', 'En Proceso', 'Resuelto', 'Cerrado'];
const COLOR_ESTADO = { 'Abierto': '#0ea5e9', 'Asignado': '#14b8a6', 'En Proceso': '#f59e0b', 'Resuelto': '#10b981', 'Cerrado': '#064e3b', 'Rechazado': '#ef4444' };

/* RF-03: Máquina de estados — transiciones permitidas y rol que puede ejecutarlas */
const TRANSICIONES = {
  'Abierto':    ['Asignado', 'Rechazado'],
  'Asignado':   ['En Proceso', 'Rechazado'],
  'En Proceso': ['Resuelto'],
  'Resuelto':   ['Cerrado'],
  'Cerrado':    [],
  'Rechazado':  []
};
const PERMISOS = {
  'Asignado':   ['admin'],
  'Rechazado':  ['admin'],
  'En Proceso': ['mantenimiento'],
  'Resuelto':   ['mantenimiento'],
  'Cerrado':    ['admin', 'solicitante']
};

/* =========================================================
   2. UTILIDADES
   ========================================================= */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const slug = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const promedio = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
const TITULOS = /^(dr|dra|ing|lic|mtro|mtra|prof)\.?$/i;

function fmtFecha(ts) {
  return new Date(ts).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function fmtHoras(h) {
  if (!isFinite(h) || h <= 0) return '0 min';
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} días`;
}
function hace(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'justo ahora';
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return `hace ${d} día${d > 1 ? 's' : ''}`;
}
function saludo() {
  const h = new Date().getHours();
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
}
function primerNombre(nombre) { return nombre.split(' ').filter(p => !TITULOS.test(p))[0] || nombre; }
function iniciales(nombre) {
  return nombre.split(' ').filter(p => p && !TITULOS.test(p)).slice(0, 2).map(p => p[0]).join('').toUpperCase();
}
function nombreDesdeCorreo(email) {
  return email.split('@')[0].split(/[._-]/).filter(Boolean).map(p => p[0].toUpperCase() + p.slice(1)).join(' ');
}
function nombreDe(email) { return USUARIOS.find(u => u.email === email)?.name || email || ''; }
function edificio(id) { return CATALOGO.find(e => e.id === id); }
function edCorto(ed) { return ed.nombre.split(' · ')[1] || ed.nombre; }
const tecnicoDe = t => t.tecnicoNombre || tecnicoDe(t);
const bgImg = src => `--img:${src ? `url('${src}')` : 'none'}`;
const catDe = nombre => CATEGORIAS[nombre] || { icono: 'box', img: null, desc: '' };
function edificioNombre(id) { return edificio(id)?.nombre || id; }
function nivelNombre(edId, nivId) { return edificio(edId)?.niveles.find(n => n.id === nivId)?.nombre || nivId; }
function ubicTexto(t) { return `Edif. ${t.ubicacion.edificio} · ${nivelNombre(t.ubicacion.edificio, t.ubicacion.nivel)} · ${t.ubicacion.espacio}`; }
function isTyping() { return ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName); }

function activosPara(espacio) {
  const e = espacio.toLowerCase();
  if (e.includes('sanitario')) return ['Espacio en general', 'Lavabo / llave', 'WC / mingitorio', 'Luminarias', 'Puerta / cerradura', 'Piso'];
  if (/lab|site|cómputo/.test(e)) return ['Espacio en general', 'Equipo de cómputo', 'Nodo de red', 'Access point Wi-Fi', 'Contactos / apagadores', 'Luminarias', 'Aire acondicionado', 'Lavabo / llave', 'Mesas / bancos', 'Puerta / cerradura'];
  if (/aula|sala|auditorio/.test(e)) return ['Espacio en general', 'Proyector', 'Pantalla / TV', 'Pupitres / sillas', 'Escritorio', 'Pizarrón', 'Luminarias', 'Contactos / apagadores', 'Aire acondicionado', 'Ventanas', 'Muros / techo', 'Puerta / cerradura', 'Access point Wi-Fi'];
  return ['Espacio en general', 'Luminarias', 'Contactos / apagadores', 'Mobiliario', 'Muros / techo', 'Piso', 'Puerta / cerradura', 'Ventanas', 'Access point Wi-Fi'];
}

/* ---------- Íconos SVG ---------- */
const ICONOS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  plus: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  list: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  camera: '<path d="M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="4"/>',
  pin: '<path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert: '<path d="M12 3 2 21h20L12 3z"/><path d="M12 10v5M12 18h.01"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>',
  chair: '<path d="M7 3h10v9H7z"/><path d="M5 12h14v3H5zM7 15v6M17 15v6"/>',
  wifi: '<path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1"/>',
  drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  building: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1M10 21v-3h4v3"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z"/><path d="m9 12 2 2 4-4"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5V8z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  door: '<path d="M4 21h16M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17"/><path d="M14 12h.01"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.7 5.7 12.6 12.6"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="m14 6 4 4"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3"/>',
  wifiOff: '<path d="M3 3l18 18"/><path d="M8.5 16a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 5-2.7M14.5 9.9a10 10 0 0 1 4.5 2.6M2 9a15 15 0 0 1 4.6-3.1M10.5 4.1A15 15 0 0 1 22 9"/><circle cx="12" cy="19.5" r="1"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  fire: '<path d="M12 22c4.4 0 7-2.9 7-6.6 0-3.4-2.2-5.6-3.6-7.6-.4 1.7-1.3 2.8-2.6 3.3.3-3.3-1.2-6.4-3.8-8.1.2 3.3-1.6 5.2-3.2 7C6.6 11.6 5 13.4 5 15.6 5 19.2 7.6 22 12 22z"/><path d="M12 22c-1.7 0-3-1.2-3-3 0-1.6 1.3-2.8 2.2-4 .5 1 1.4 1.6 2.3 1.9.9.3 1.5 1.1 1.5 2.1 0 1.8-1.3 3-3 3z"/>',
  monitor: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  smartphone: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
  server: '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  clipboard: '<rect x="5" y="4" width="14" height="18" rx="2"/><path d="M9 4V2h6v2M9 11l2 2 4-4M9 17h6"/>'
};
function icon(nombre, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONOS[nombre] || ''}</svg>`;
}

/* ---------- Bus de eventos: comunica los módulos entre sí ---------- */
const Bus = {
  eventos: {},
  on(nombre, fn) { (this.eventos[nombre] ??= []).push(fn); },
  emit(nombre, datos) { (this.eventos[nombre] || []).forEach(fn => fn(datos)); }
};

/* =========================================================
   3. COMUNICACIÓN CON EL SERVIDOR Y AUTENTICACIÓN — RF-01
   El servidor (Express) valida el token JWT en cada petición
   y responde con los datos guardados en SQLite.
   ========================================================= */

/* Si la página se abre con Live Server o como archivo, la API sigue en localhost:3000 */
const API_ORIGEN = (location.protocol === 'file:' || /^55\d\d$/.test(location.port)) ? 'http://localhost:3000' : '';
const urlArchivo = ruta => (!ruta || /^(data:|https?:)/.test(ruta) || !ruta.startsWith('uploads/')) ? ruta : `${API_ORIGEN}/${ruta}`;

async function api(ruta, { method = 'GET', body } = {}) {
  const token = Auth.token();
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${API_ORIGEN}/api${ruta}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('No hay conexión con el servidor. Verifica que esté encendido con "npm start".');
  }
  let datos = null;
  try { datos = await res.json(); } catch { /* respuesta sin cuerpo */ }
  if (res.status === 401 && token) {
    Auth.logout();
    setTimeout(() => cerrarSesion(true), 0);
    throw new Error(datos?.error || 'Tu sesión expiró.');
  }
  if (!res.ok) throw new Error(datos?.error || `Error ${res.status} del servidor.`);
  return datos;
}

function desdeB64url(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
}

const Auth = {
  token() {
    // Punto 13: la sesión se guarda en localStorage para que persista al cerrar la app o sin internet
    try { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  guardar(token) {
    try { localStorage.setItem(TOKEN_KEY, token); } catch { /* navegador sin almacenamiento */ }
  },
  async login(email, password) {
    email = email.trim().toLowerCase();
    if (!email) throw new Error('Ingresa tu correo institucional.');
    if (!email.endsWith(DOMINIO)) throw new Error(`Solo se permiten cuentas institucionales (${DOMINIO}).`);
    if (!password) throw new Error('Ingresa tu contraseña.');
    const r = await api('/auth/login', { method: 'POST', body: { correo: email, password } });
    this.guardar(r.token);
    return this.sesion();
  },
  async registro(datos) {
    const r = await api('/auth/registro', { method: 'POST', body: datos });
    this.guardar(r.token);
    return this.sesion();
  },
  async refrescar() {
    const r = await api('/auth/yo');
    this.guardar(r.token);
    return this.sesion();
  },
  /* Lee el contenido del token (la firma la valida el servidor) */
  sesion() {
    const token = this.token();
    if (!token) return null;
    try {
      const d = desdeB64url(token.split('.')[1]);
      if (d.exp * 1000 < Date.now()) { this.logout(); return null; }
      return { id: d.uid, email: d.sub, name: d.name, role: d.role, exp: d.exp, avatar: d.avatar };
    } catch {
      this.logout();
      return null;
    }
  },
  logout() {
    try { localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_KEY); } catch { /* sin almacenamiento */ }
  }
};

/* =========================================================
   4. DATOS EN MEMORIA (copia de lo que hay en el servidor)
   ========================================================= */
const DB = {
  data: { tickets: [], notifications: [] },
  get tickets() { return this.data.tickets; },
  ticket(id) { return this.data.tickets.find(t => t.id === id); },

  async cargarCatalogo() {
    const c = await api('/catalogo');
    CATALOGO = c.edificios;
    CATEGORIAS = Object.fromEntries(c.categorias.map(x => [x.nombre, {
      id: x.id, icono: ICONOS[x.icono] ? x.icono : 'box', img: x.img, desc: x.desc || '', tickets: x.tickets
    }]));
    SEVERIDADES = Object.fromEntries(c.severidades.map(s => [s.nombre, { sla: s.sla, desc: s.desc || '' }]));
    USUARIOS = c.personal.map(u => ({ email: u.correo, name: u.nombre, role: u.rol, avatar: u.avatar }));
  },

  async sync() {
    const [tickets, notificaciones] = await Promise.all([api('/tickets'), api('/notificaciones'), this.cargarCatalogo()]);
    this.data.tickets = tickets.map(t => ({
      ...t,
      foto: urlArchivo(t.foto),
      resolucion: t.resolucion ? { ...t.resolucion, foto: urlArchivo(t.resolucion.foto) } : null
    }));
    this.data.notifications = notificaciones;
  }
};

/* Vuelve a pedir los datos y refresca la pantalla (evita peticiones duplicadas) */
let syncEnCurso = null;
let syncOtraVez = false;
function sincronizar() {
  if (syncEnCurso) { syncOtraVez = true; return syncEnCurso; }
  syncEnCurso = (async () => {
    do { syncOtraVez = false; await DB.sync(); } while (syncOtraVez);
  })().finally(() => { syncEnCurso = null; });
  return syncEnCurso.then(() => { Bus.emit('data'); entregarNotificaciones(); });
}

/* =========================================================
   5. SERVICIO DE TICKETS — RF-02, RF-03, RF-04
   La validación definitiva y la máquina de estados viven en
   el servidor; aquí se valida antes para responder rápido.
   ========================================================= */
const Tickets = {
  async crear(d) {
    const requeridos = [['edificio', 'el edificio'], ['nivel', 'el nivel'], ['espacio', 'el espacio o aula'], ['activo', 'el activo afectado'], ['categoria', 'la categoría del problema'], ['severidad', 'la severidad']];
    for (const [k, l] of requeridos) if (!d[k]) throw new Error(`Selecciona ${l}.`);
    if (!d.foto) throw new Error('Captura una fotografía como evidencia de la incidencia.');
    if (!d.descripcion || d.descripcion.trim().length < 10) throw new Error('Describe el problema con al menos 10 caracteres.');
    const r = await api('/tickets', { method: 'POST', body: d });
    await sincronizar();
    return DB.ticket(r.folio) || { id: r.folio };
  },
  async transicion(id, destino, extra = {}) {
    await api(`/tickets/${encodeURIComponent(id)}/transicion`, { method: 'POST', body: { estado: destino, ...extra } });
    await sincronizar();
  },
  async eliminar(id) {
    await api(`/tickets/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await sincronizar();
  }
};

/* ---------- Tiempo real: el servidor avisa cuando algo cambia ---------- */
let fuenteEventos = null;
let temporizadorSync;
function conectarEventos() {
  desconectarEventos();
  const token = Auth.token();
  if (!token || !('EventSource' in window)) return;
  fuenteEventos = new EventSource(`${API_ORIGEN}/api/eventos?token=${encodeURIComponent(token)}`);
  const programar = () => {
    clearTimeout(temporizadorSync);
    temporizadorSync = setTimeout(() => { if (Auth.sesion()) sincronizar().catch(() => {}); }, 150);
  };
  fuenteEventos.addEventListener('cambio', programar);
  fuenteEventos.addEventListener('conectado', programar);
  fuenteEventos.onerror = () => { if (!Auth.sesion()) desconectarEventos(); };
}
function desconectarEventos() {
  fuenteEventos?.close();
  fuenteEventos = null;
}

/* ---------- Cálculos de SLA y métricas ---------- */
const esActivo = t => ['Abierto', 'Asignado', 'En Proceso'].includes(t.estado);
const tiempoResolucion = t => t.resolucion ? (t.resolucion.at - t.createdAt) / HORA : null;
const enSLA = t => { const r = tiempoResolucion(t); return r !== null && r <= SEVERIDADES[t.severidad].sla; };
const estaDemorado = t => esActivo(t) && (Date.now() - t.createdAt) / HORA > SEVERIDADES[t.severidad].sla;
const porPrioridad = (a, b) => (estaDemorado(b) - estaDemorado(a)) || (ORDEN_SEV[a.severidad] - ORDEN_SEV[b.severidad]) || (a.createdAt - b.createdAt);

function slaInfo(t) {
  const limite = SEVERIDADES[t.severidad].sla;
  if (t.estado === 'Rechazado') return { txt: 'No aplica', cls: 'muted', pct: 0 };
  const fin = t.resolucion ? t.resolucion.at : Date.now();
  const h = (fin - t.createdAt) / HORA;
  const pct = Math.min(100, h / limite * 100);
  if (t.resolucion) return h <= limite ? { txt: `Resuelto en ${fmtHoras(h)}`, cls: 'ok', pct } : { txt: `Fuera de SLA (${fmtHoras(h)})`, cls: 'bad', pct: 100 };
  const resta = limite - h;
  if (resta < 0) return { txt: `Demorado ${fmtHoras(-resta)}`, cls: 'bad', pct: 100 };
  return { txt: `Quedan ${fmtHoras(resta)}`, cls: resta < limite * 0.25 ? 'warn' : 'ok', pct };
}

/* =========================================================
   6. ESTADO DE LA INTERFAZ
   ========================================================= */
const nuevoReporte = () => ({ edificio: '', nivel: '', espacio: '', activo: '', categoria: '', severidad: '', foto: '', descripcion: '' });
const filtrosIniciales = () => ({ tecnico: '', edificio: '', severidad: '', estado: 'activos', q: '' });

const state = {
  vista: 'inicio',
  filtros: filtrosIniciales(),
  reporte: nuevoReporte(),
  resolucion: { foto: '' },
  filtroMis: 'todos',
  tabTareas: 'asignadas',
  periodo: 'todo',
  heatmap: 'categoria',
  modal: null
};

/* =========================================================
   7. COMPONENTES REUTILIZABLES
   ========================================================= */
function imgTag(src, alt = '') { return `<img src="${src}" alt="${esc(alt)}" loading="lazy" onerror="this.remove()">`; }
function avatarHTML(u) { return `<span>${esc(iniciales(u.name))}</span>${u.avatar ? `<img src="${u.avatar}" alt="" onerror="this.remove()">` : ''}`; }
function thumb(t) {
  const c = catDe(t.categoria);
  return `<span class="thumb cat-${slug(t.categoria)}">${icon(c.icono)}${t.foto ? `<img src="${t.foto}" alt="Evidencia">` : imgTag(c.img, t.categoria)}</span>`;
}
const estadoChip = e => `<span class="chip st-${slug(e)}">${esc(e)}</span>`;
const sevChip = s => `<span class="sev sev-${slug(s)}"><i></i>${esc(s)}</span>`;

function progreso(t) {
  if (t.estado === 'Rechazado') return `<div class="progress-rejected">${icon('ban')} Reporte rechazado</div>`;
  const idx = FLUJO.indexOf(t.estado);
  return `<ol class="progress">${FLUJO.map((st, i) => `<li class="${i < idx ? 'done' : i === idx ? 'now' : ''}"><span></span><small>${st}</small></li>`).join('')}</ol>`;
}

function accionesDisponibles(t, s) {
  const a = [];
  if (s.role === 'admin') {
    if (t.estado === 'Abierto') a.push(['asignar', 'Asignar técnico', 'primary']);
    if (['Abierto', 'Asignado'].includes(t.estado)) a.push(['rechazar', 'Rechazar', 'danger']);
    if (t.estado === 'Resuelto') a.push(['cerrar', 'Validar y cerrar', 'primary']);
  }
  if (s.role === 'mantenimiento' && t.tecnico === s.email) {
    if (t.estado === 'Asignado') a.push(['iniciar', 'Iniciar trabajo', 'primary']);
    if (t.estado === 'En Proceso') a.push(['resolver', 'Registrar solución', 'primary']);
  }
  if (s.role === 'solicitante' && t.solicitante.email === s.email && t.estado === 'Resuelto') a.push(['cerrar', 'Confirmar y cerrar', 'primary']);
  if (s.role === 'solicitante' && t.solicitante.email === s.email && t.estado === 'Abierto') a.push(['cancelar', 'Cancelar reporte', 'danger']);
  return a;
}
function botonesAccion(t, s, chico = false) {
  return accionesDisponibles(t, s).map(([accion, etiqueta, tipo]) =>
    `<button class="btn btn-${tipo} ${chico ? 'btn-sm' : ''}" data-action="${accion}" data-id="${t.id}">${etiqueta}</button>`).join('');
}

function ticketCard(t, s) {
  const si = slaInfo(t);
  return `
  <article class="ticket-card ${estaDemorado(t) ? 'is-late' : ''}">
    <button class="ticket-media" data-action="ver" data-id="${t.id}" aria-label="Ver ${t.id}">${thumb(t)}</button>
    <div class="ticket-body">
      <div class="ticket-top"><span class="folio">${t.id}</span>${estadoChip(t.estado)}</div>
      <h4>${esc(t.categoria)} · ${esc(t.ubicacion.activo)}</h4>
      <p class="ticket-loc">${icon('pin')} ${esc(ubicTexto(t))}</p>
      ${progreso(t)}
      <div class="ticket-foot">${sevChip(t.severidad)}<span class="sla sla-${si.cls}">${icon('clock')} ${si.txt}</span></div>
      <div class="ticket-actions">
        <button class="btn btn-ghost btn-sm" data-action="ver" data-id="${t.id}">${icon('eye')} Detalle</button>
        ${botonesAccion(t, s, true)}
      </div>
    </div>
  </article>`;
}

function listaCompacta(lista) {
  if (!lista.length) return vacio('Sin actividad todavía', 'Aquí verás los movimientos más recientes.');
  return `<ul class="mini-list">${lista.map(t => `
    <li><button data-action="ver" data-id="${t.id}">${thumb(t)}
      <span class="mini-body"><strong>${t.id} · ${esc(t.categoria)}</strong><small>${esc(ubicTexto(t))} · ${hace(t.updatedAt)}</small></span>
      ${estadoChip(t.estado)}</button></li>`).join('')}</ul>`;
}

function vacio(titulo, texto, ic = 'checkCircle') {
  return `<div class="empty">${icon(ic)}<strong>${titulo}</strong><p class="small">${texto}</p></div>`;
}

function barRow(etiqueta, pct, valor, extra = '') {
  return `<div class="bar-row"><span title="${esc(etiqueta)}">${esc(etiqueta)}</span><div class="bar ${extra}"><i style="width:${Math.max(0, Math.min(100, pct || 0))}%"></i></div><b>${valor}</b></div>`;
}

function photoZoneInner(foto, campo) {
  if (foto) return `<img src="${foto}" alt="Vista previa de la fotografía"><button type="button" class="photo-remove" data-action="quitar-foto" data-field="${campo}">${icon('trash')} Quitar</button>`;
  return `<label class="photo-pick"><input type="file" accept="image/*" capture="environment" data-photo="${campo}">${icon('camera')}<strong>Tomar o subir fotografía</strong><small>En el celular se abrirá la cámara · JPG o PNG</small></label>`;
}

/* Comprime la foto para que quepa en el almacenamiento local */
function comprimirImagen(file, max = 900, calidad = 0.7) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('El archivo debe ser una imagen.'));
    const lector = new FileReader();
    lector.onload = () => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * k);
        canvas.height = Math.round(img.height * k);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', calidad));
      };
      img.onerror = () => reject(new Error('No se pudo leer la imagen.'));
      img.src = lector.result;
    };
    lector.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    lector.readAsDataURL(file);
  });
}

/* =========================================================
   8. VISTAS
   ========================================================= */
const RENDER = {

  /* ---------- INICIO (todos los roles) ---------- */
  inicio(s) {
    const T = DB.tickets;
    let stats, acciones, banner, texto, recientes;
    if (s.role === 'solicitante') {
      const mios = T.filter(t => t.solicitante.email === s.email);
      stats = [['Reportes activos', mios.filter(esActivo).length, 'clock'], ['Resueltos', mios.filter(t => ['Resuelto', 'Cerrado'].includes(t.estado)).length, 'checkCircle'], ['Total levantados', mios.length, 'list']];
      acciones = [['reportar', 'Reportar incidencia', 'plus', 'btn-light'], ['mis-tickets', 'Ver mis reportes', 'list', 'btn-glass']];
      banner = 'img/banner-inicio.jpg';
      texto = '¿Detectaste una falla en tu aula, laboratorio o sanitario? Repórtala en menos de un minuto y sigue su avance en tiempo real.';
      recientes = mios;
    } else if (s.role === 'mantenimiento') {
      const mias = T.filter(t => t.tecnico === s.email);
      stats = [['Por iniciar', mias.filter(t => t.estado === 'Asignado').length, 'clock'], ['En proceso', mias.filter(t => t.estado === 'En Proceso').length, 'wrench'], ['Resueltas por mí', mias.filter(t => t.resolucion).length, 'checkCircle']];
      acciones = [['tareas', 'Ver mis órdenes', 'wrench', 'btn-light'], ['notificaciones', 'Notificaciones', 'bell', 'btn-glass']];
      banner = 'img/banner-mantenimiento.jpg';
      texto = 'Consulta tus órdenes de trabajo priorizadas por severidad y registra la evidencia de cada solución.';
      recientes = mias;
    } else {
      const res = T.filter(t => t.resolucion);
      const sla = res.length ? Math.round(res.filter(enSLA).length / res.length * 100) : 0;
      stats = [['Órdenes activas', T.filter(esActivo).length, 'grid'], ['Demoradas', T.filter(estaDemorado).length, 'alert'], ['Cumplimiento SLA', `${sla}%`, 'chart']];
      acciones = [['dashboard', 'Abrir dashboard', 'grid', 'btn-light'], ['basedatos', 'Base de datos', 'database', 'btn-glass'], ['usuarios', 'Usuarios', 'users', 'btn-glass']];
      banner = 'img/banner-admin.jpg';
      texto = 'Supervisa el estatus de las actividades de mantenimiento del campus, asigna técnicos y vigila los acuerdos de nivel de servicio.';
      recientes = T;
    }
    recientes = recientes.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5);

    return `
    <section class="hero-banner" style="--bg:url('${banner}')">
      <div class="hero-banner-content">
        <span class="pill pill-glass">${icon('shield')} ${esc(ROLES[s.role].label)}</span>
        <h2>${saludo()}, ${esc(primerNombre(s.name))}</h2>
        <p>${texto}</p>
        <div class="btn-row">${acciones.map(([v, l, ic, cls]) => `<button class="btn ${cls}" data-action="nav" data-view="${v}">${icon(ic)} ${l}</button>`).join('')}</div>
      </div>
    </section>

    <section class="stat-grid">
      ${stats.map(([l, v, ic], i) => `<article class="stat-card tone-${i}"><span class="stat-ic">${icon(ic)}</span><div><strong>${v}</strong><span>${l}</span></div></article>`).join('')}
    </section>

    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h3>Edificios del campus</h3><span class="muted small">Incidencias activas por edificio</span></div>
        <div class="building-grid">
          ${CATALOGO.map(ed => {
            const n = ed.activos ?? T.filter(t => t.ubicacion.edificio === ed.id && esActivo(t)).length;
            return `<button class="building-card" data-action="edificio" data-id="${ed.id}" style="${bgImg(ed.img)}">
              <span class="building-badge">${n} activa${n === 1 ? '' : 's'}</span>
              <span class="building-name"><small>Edificio ${ed.id}</small>${esc(edCorto(ed))}</span>
            </button>`;
          }).join('')}
        </div>
      </section>
      <section class="card">
        <div class="card-head"><h3>Actividad reciente</h3><span class="muted small">Últimos movimientos</span></div>
        ${listaCompacta(recientes)}
      </section>
    </div>`;
  },

  /* ---------- REPORTAR INCIDENCIA (RF-02) ---------- */
  reportar() {
    const r = state.reporte;
    const ed = edificio(r.edificio);
    const niv = ed?.niveles.find(n => n.id === r.nivel);
    return `
    <div class="report-layout">
      <form class="card form-card" data-form="reporte" novalidate>
        <div class="form-step">
          <div class="step-head"><span class="step-n">1</span><div><h3>Ubicación física</h3><p class="muted small">Selecciona desde el catálogo del campus.</p></div></div>
          <div class="field-grid">
            ${selectCampo('edificio', 'Edificio', 'building', CATALOGO.map(e => [e.id, e.nombre]), r.edificio)}
            ${selectCampo('nivel', 'Nivel', 'layers', ed ? ed.niveles.map(n => [n.id, n.nombre]) : [], r.nivel, !ed)}
            ${selectCampo('espacio', 'Espacio / Aula', 'door', niv ? niv.espacios.map(x => [x, x]) : [], r.espacio, !niv)}
            ${selectCampo('activo', 'Activo afectado', 'box', r.espacio ? activosPara(r.espacio).map(x => [x, x]) : [], r.activo, !r.espacio)}
          </div>
          <div class="breadcrumb" id="ubicPreview">${migas(r)}</div>
        </div>

        <div class="form-step">
          <div class="step-head"><span class="step-n">2</span><div><h3>Categoría del problema</h3><p class="muted small">Elige el tipo de falla.</p></div></div>
          <div class="cat-grid">
            ${Object.entries(CATEGORIAS).map(([k, c]) => `
              <label class="cat-card cat-${slug(k)} ${r.categoria === k ? 'is-on' : ''}" style="${bgImg(c.img)}">
                <input type="radio" name="categoria" value="${k}" ${r.categoria === k ? 'checked' : ''}>
                <span class="cat-media">${icon(c.icono)}</span>
                <span class="cat-txt"><strong>${k}</strong><small>${c.desc}</small></span>
                <span class="cat-check">${icon('check')}</span>
              </label>`).join('')}
          </div>
        </div>

        <div class="form-step">
          <div class="step-head"><span class="step-n">3</span><div><h3>Severidad</h3><p class="muted small">Define el tiempo máximo de atención (SLA).</p></div></div>
          <div class="sev-grid">
            ${Object.entries(SEVERIDADES).map(([k, v]) => `
              <label class="sev-card lvl-${slug(k)} ${r.severidad === k ? 'is-on' : ''}">
                <input type="radio" name="severidad" value="${k}" ${r.severidad === k ? 'checked' : ''}>
                <span class="sev-dot"></span><strong>${k}</strong><small>Atención en un máximo de ${v.sla} h</small><em>${v.desc}</em>
              </label>`).join('')}
          </div>
        </div>

        <div class="form-step">
          <div class="step-head"><span class="step-n">4</span><div><h3>Evidencia y descripción</h3><p class="muted small">La fotografía es obligatoria.</p></div></div>
          <div class="photo-zone ${r.foto ? 'has-photo' : ''}">${photoZoneInner(r.foto, 'foto')}</div>
          <label class="field">
            <span>Descripción del problema</span>
            <textarea name="descripcion" rows="4" maxlength="500" placeholder="Describe qué ocurre, desde cuándo y si representa un riesgo.">${esc(r.descripcion)}</textarea>
            <small class="hint"><span id="descCount">${r.descripcion.length}</span>/500</small>
          </label>
        </div>

        <div class="alert alert-error" hidden></div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-action="limpiar-reporte">${icon('refresh')} Limpiar</button>
          <button type="submit" class="btn btn-primary btn-lg">${icon('send')} Enviar reporte</button>
        </div>
      </form>

      <aside class="report-aside">
        <div class="card summary-card"><h3>Resumen del reporte</h3><div id="resumenReporte">${resumen(r)}</div></div>
        <div class="card tips-card">
          <h4>${icon('info')} Recomendaciones</h4>
          <ul>
            <li>Toma la fotografía de frente y con buena iluminación.</li>
            <li>Incluye una referencia visible: número de aula, equipo o mesa.</li>
            <li>Si hay riesgo eléctrico o de agua, márcalo como <b>Crítica</b> y aléjate de la zona.</li>
          </ul>
        </div>
      </aside>
    </div>`;
  },

  /* ---------- MIS REPORTES (solicitante) ---------- */
  'mis-tickets'(s) {
    const mios = DB.tickets.filter(t => t.solicitante.email === s.email).sort((a, b) => b.updatedAt - a.updatedAt);
    const filtros = {
      todos: ['Todos', () => true], activos: ['Activos', esActivo], resueltos: ['Por confirmar', t => t.estado === 'Resuelto'],
      cerrados: ['Cerrados', t => t.estado === 'Cerrado'], rechazados: ['Rechazados', t => t.estado === 'Rechazado']
    };
    const lista = mios.filter(filtros[state.filtroMis][1]);
    return `
    <div class="toolbar">
      <div class="chip-filters">${Object.entries(filtros).map(([k, [l, f]]) => `<button class="fchip ${state.filtroMis === k ? 'is-on' : ''}" data-action="filtro-mis" data-f="${k}">${l}<b>${mios.filter(f).length}</b></button>`).join('')}</div>
      <button class="btn btn-primary" data-action="nav" data-view="reportar">${icon('plus')} Nuevo reporte</button>
    </div>
    ${lista.length ? `<div class="ticket-grid">${lista.map(t => ticketCard(t, s)).join('')}</div>`
      : `<section class="card">${vacio('No hay reportes en esta sección', 'Cuando levantes un reporte aparecerá aquí con su avance.', 'list')}</section>`}`;
  },

  /* ---------- ÓRDENES DE TRABAJO (mantenimiento) ---------- */
  tareas(s) {
    const mias = DB.tickets.filter(t => t.tecnico === s.email);
    const tabs = {
      asignadas: ['Por iniciar', t => t.estado === 'Asignado'],
      proceso:   ['En proceso', t => t.estado === 'En Proceso'],
      resueltas: ['Resueltas', t => ['Resuelto', 'Cerrado'].includes(t.estado)]
    };
    const lista = mias.filter(tabs[state.tabTareas][1]).sort(state.tabTareas === 'resueltas' ? (a, b) => b.updatedAt - a.updatedAt : porPrioridad);
    const activas = mias.filter(esActivo);
    return `
    <section class="hero-banner hero-sm" style="--bg:url('img/banner-mantenimiento.jpg')">
      <div class="hero-banner-content">
        <span class="pill pill-glass">${icon('wrench')} Mis órdenes de trabajo</span>
        <h2>${activas.length} orden${activas.length === 1 ? '' : 'es'} activa${activas.length === 1 ? '' : 's'}</h2>
        <p>${activas.filter(t => t.severidad === 'Crítica').length} de prioridad crítica · ${mias.filter(estaDemorado).length} fuera de SLA. Se muestran primero las más urgentes.</p>
      </div>
    </section>
    <div class="toolbar">
      <div class="tabs">${Object.entries(tabs).map(([k, [l, f]]) => `<button class="tab ${state.tabTareas === k ? 'is-on' : ''}" data-action="tab" data-tab="${k}">${l}<b>${mias.filter(f).length}</b></button>`).join('')}</div>
    </div>
    ${lista.length ? `<div class="ticket-grid">${lista.map(t => ticketCard(t, s)).join('')}</div>`
      : `<section class="card">${vacio('Sin órdenes en esta sección', 'Cuando administración te asigne un reporte aparecerá aquí y recibirás una notificación.', 'wrench')}</section>`}`;
  },

  /* ---------- DASHBOARD ADMINISTRATIVO (RF-06) ---------- */
  dashboard(s) {
    const T = DB.tickets;
    const f = state.filtros;
    const tecnicos = USUARIOS.filter(u => u.role === 'mantenimiento');
    const kpis = [
      ['Órdenes activas', T.filter(esActivo).length, 'grid', `${T.length} tickets registrados`, 'activos'],
      ['Pendientes', T.filter(t => t.estado === 'Abierto').length, 'clock', `${T.filter(t => t.estado === 'Asignado').length} asignadas sin iniciar`, 'Abierto'],
      ['En progreso', T.filter(t => t.estado === 'En Proceso').length, 'wrench', 'Técnicos trabajando ahora', 'En Proceso'],
      ['Demoradas', T.filter(estaDemorado).length, 'alert', 'Exceden el tiempo de SLA', 'demorados']
    ];
    const cargas = tecnicos.map(tc => T.filter(t => t.tecnico === tc.email && esActivo(t)).length);
    const maxCarga = Math.max(1, ...cargas);

    return `
    <section class="kpi-grid">
      ${kpis.map(([l, v, ic, sub, fe], i) => `
        <button class="kpi kpi-${i} ${f.estado === fe ? 'is-sel' : ''}" data-action="kpi" data-estado="${fe}">
          ${i === 3 && v > 0 ? '<span class="pulse"></span>' : ''}
          <div class="kpi-top"><span>${l}</span><span class="kpi-ic">${icon(ic)}</span></div>
          <strong>${v}</strong><small>${sub}</small>
        </button>`).join('')}
    </section>

    <section class="card">
      <div class="card-head">
        <div><h3>Reporte de estatus de actividades</h3><p class="muted small">Se actualiza en tiempo real cuando cualquier usuario realiza un cambio.</p></div>
        <div class="btn-row">
          <button class="btn btn-ghost btn-sm" data-action="export-csv">${icon('download')} Exportar CSV</button>
          <button class="btn btn-ghost btn-sm" data-action="reset-filtros">${icon('refresh')} Limpiar filtros</button>
        </div>
      </div>
      <div class="filters">
        ${filtroSelect('tecnico', 'Técnico responsable', [['', 'Todos'], ['__none', 'Sin asignar'], ...tecnicos.map(t => [t.email, t.name])])}
        ${filtroSelect('edificio', 'Edificio', [['', 'Todos'], ...CATALOGO.map(e => [e.id, e.nombre])])}
        ${filtroSelect('severidad', 'Severidad', [['', 'Todas'], ...Object.keys(SEVERIDADES).map(k => [k, k])])}
        ${filtroSelect('estado', 'Estado', [['activos', 'Activos'], ['todos', 'Todos'], ['demorados', 'Demorados'], ...ESTADOS.map(e => [e, e])])}
        <label class="field f-search"><span>Buscar</span>
          <div class="input-icon"><span>${icon('search')}</span><input type="search" data-filter="q" value="${esc(f.q)}" placeholder="Folio, espacio, descripción…"></div>
        </label>
      </div>
    </section>

    <div class="dash-layout">
      <section class="card" id="dashResults">${resultadosDashboard(s)}</section>
      <aside class="dash-aside">
        <section class="card">
          <div class="card-head"><h3>Carga por técnico</h3><span class="muted small">Órdenes activas</span></div>
          ${tecnicos.map((tc, i) => `
            <div class="load-row">
              <span class="avatar">${avatarHTML(tc)}</span>
              <div><strong class="small">${esc(tc.name)}</strong><div class="bar"><i style="width:${cargas[i] / maxCarga * 100}%"></i></div></div>
              <b>${cargas[i]}</b>
            </div>`).join('')}
        </section>
        <section class="card">
          <div class="card-head"><h3>Distribución por estado</h3></div>
          ${barraEstados(T)}
        </section>
        <section class="card cta-card">
          <h3>Analítica operativa</h3>
          <p>Consulta el MTTR, el cumplimiento de SLA y el mapa de calor de incidencias recurrentes.</p>
          <button class="btn btn-light btn-sm" data-action="nav" data-view="metricas">${icon('chart')} Ver métricas</button>
        </section>
      </aside>
    </div>`;
  },

  /* ---------- MÉTRICAS (RF-07) ---------- */
  metricas() {
    const desde = state.periodo === 'todo' ? 0 : Date.now() - Number(state.periodo) * 24 * HORA;
    const T = DB.tickets.filter(t => t.createdAt >= desde);
    const res = T.filter(t => t.resolucion);
    const aTiempo = res.filter(enSLA).length;
    const mttr = promedio(res.map(tiempoResolucion));
    const sla = res.length ? Math.round(aTiempo / res.length * 100) : 0;
    const rechazo = T.length ? Math.round(T.filter(t => t.estado === 'Rechazado').length / T.length * 100) : 0;
    const cats = Object.keys(CATEGORIAS);
    const mttrCat = cats.map(c => { const r = res.filter(t => t.categoria === c); return { c, n: r.length, m: promedio(r.map(tiempoResolucion)) }; });
    const maxM = Math.max(1, ...mttrCat.map(x => x.m));
    const conteoCat = cats.map(c => ({ c, n: T.filter(t => t.categoria === c).length }));
    const maxN = Math.max(1, ...conteoCat.map(x => x.n));

    const zonas = {};
    T.forEach(t => { const k = `Edificio ${t.ubicacion.edificio} · ${t.ubicacion.espacio}`; zonas[k] = (zonas[k] || 0) + 1; });
    const topZonas = Object.entries(zonas).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const maxZ = Math.max(1, ...topZonas.map(z => z[1]));

    const tecnicos = USUARIOS.filter(u => u.role === 'mantenimiento').map(tc => {
      const asig = T.filter(t => t.tecnico === tc.email);
      const r = asig.filter(t => t.resolucion);
      return { tc, asig: asig.length, res: r.length, mttr: promedio(r.map(tiempoResolucion)), sla: r.length ? Math.round(r.filter(enSLA).length / r.length * 100) : null };
    });

    return `
    <div class="toolbar">
      <p class="muted">Indicadores calculados sobre <b>${T.length}</b> tickets, de los cuales <b>${res.length}</b> están resueltos.</p>
      <div class="tabs">${[['7', '7 días'], ['30', '30 días'], ['todo', 'Histórico']].map(([k, l]) => `<button class="tab ${state.periodo === k ? 'is-on' : ''}" data-action="periodo" data-p="${k}">${l}</button>`).join('')}</div>
    </div>

    <section class="kpi-grid">
      <article class="kpi kpi-0"><div class="kpi-top"><span>MTTR</span><span class="kpi-ic">${icon('clock')}</span></div><strong>${res.length ? fmtHoras(mttr) : '—'}</strong><small>Tiempo medio de resolución</small></article>
      <article class="kpi kpi-1"><div class="kpi-top"><span>Cumplimiento SLA</span><span class="kpi-ic">${icon('shield')}</span></div><strong>${res.length ? sla + '%' : '—'}</strong><small>${aTiempo} de ${res.length} resueltos a tiempo</small></article>
      <article class="kpi kpi-2"><div class="kpi-top"><span>Resueltos</span><span class="kpi-ic">${icon('checkCircle')}</span></div><strong>${res.length}</strong><small>Con evidencia registrada</small></article>
      <article class="kpi kpi-3"><div class="kpi-top"><span>Tasa de rechazo</span><span class="kpi-ic">${icon('ban')}</span></div><strong>${rechazo}%</strong><small>Reportes duplicados o fuera de alcance</small></article>
    </section>

    <div class="metric-grid">
      <section class="card">
        <div class="card-head"><h3>Cumplimiento de SLA</h3><span class="muted small">Meta institucional: 90%</span></div>
        <div class="gauge" style="--p:${sla}"><div><strong>${res.length ? sla + '%' : '—'}</strong><small class="muted">a tiempo</small></div></div>
        ${Object.keys(SEVERIDADES).map(k => {
          const r = res.filter(t => t.severidad === k);
          const p = r.length ? Math.round(r.filter(enSLA).length / r.length * 100) : 0;
          return barRow(`${k} (${SEVERIDADES[k].sla} h)`, p, r.length ? p + '%' : '—', 'target');
        }).join('')}
      </section>
      <section class="card">
        <div class="card-head"><h3>MTTR por categoría</h3><span class="muted small">Menor es mejor</span></div>
        ${mttrCat.map(x => barRow(x.c, x.m / maxM * 100, x.n ? fmtHoras(x.m) : '—')).join('')}
      </section>
      <section class="card">
        <div class="card-head"><h3>Incidencias por categoría</h3><span class="muted small">Volumen</span></div>
        ${conteoCat.map(x => barRow(x.c, x.n / maxN * 100, x.n)).join('')}
      </section>
    </div>

    <section class="card">
      <div class="card-head">
        <div><h3>Mapa de calor de incidencias recurrentes</h3><p class="muted small">Concentración de reportes por zona del campus. Coloca el cursor sobre una celda para ver el detalle.</p></div>
        <div class="tabs">${[['categoria', 'Edificio × Categoría'], ['nivel', 'Edificio × Nivel']].map(([k, l]) => `<button class="tab ${state.heatmap === k ? 'is-on' : ''}" data-action="heatmap" data-m="${k}">${l}</button>`).join('')}</div>
      </div>
      <div class="heatmap-wrap">${mapaCalor(T)}</div>
      <div class="hm-scale"><span>Menos</span><i></i><span>Más</span></div>
      <div class="btn-row" style="margin-top:14px"><button class="btn btn-primary btn-sm" data-action="nav" data-view="mapacalor">${icon('fire')} Abrir el mapa de calor interactivo</button></div>
    </section>

    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h3>Zonas con más reportes</h3><span class="muted small">Candidatas a mantenimiento preventivo</span></div>
        ${topZonas.length ? topZonas.map(([z, n], i) => `
          <div class="zone-row"><span class="zone-rank">${i + 1}</span>
            <div><strong>${esc(z)}</strong><div class="bar"><i style="width:${n / maxZ * 100}%"></i></div></div>
            <b>${n}</b></div>`).join('') : vacio('Sin datos en el periodo', 'Prueba con un periodo más amplio.', 'chart')}
      </section>
      <section class="card">
        <div class="card-head"><h3>Desempeño por técnico</h3></div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Técnico</th><th>Asignados</th><th>Resueltos</th><th>MTTR</th><th>SLA</th></tr></thead>
          <tbody>${tecnicos.map(x => `<tr>
            <td data-label="Técnico"><strong>${esc(x.tc.name)}</strong></td>
            <td data-label="Asignados">${x.asig}</td>
            <td data-label="Resueltos">${x.res}</td>
            <td data-label="MTTR">${x.res ? fmtHoras(x.mttr) : '—'}</td>
            <td data-label="SLA"><span class="sla sla-${x.sla === null ? 'muted' : x.sla >= 90 ? 'ok' : x.sla >= 70 ? 'warn' : 'bad'}">${x.sla === null ? '—' : x.sla + '%'}</span></td>
          </tr>`).join('')}</tbody>
        </table></div>
      </section>
    </div>`;
  },

  /* ---------- NOTIFICACIONES (RF-05) ---------- */
  notificaciones() {
    const lista = misNotificaciones();
    const sinLeer = lista.filter(n => !n.read).length;
    return `
    <div class="alert alert-info">${icon('info')}<div><strong>Comunicación en tiempo real.</strong> Las notificaciones se guardan en la base de datos. Abre la página en otra pestaña, otra computadora o tu celular e inicia sesión con otro rol: cada cambio de estado que haga ese usuario te llegará aquí al instante.</div></div>
    <div class="toolbar">
      <p class="muted"><b>${sinLeer}</b> sin leer de ${lista.length}</p>
      <div class="btn-row">
        ${botonPush()}
        <button class="btn btn-ghost btn-sm" data-action="notif-all-read">${icon('check')} Marcar todas como leídas</button>
        ${lista.length ? `<button class="btn btn-danger btn-sm" data-action="notif-del-all">${icon('trash')} Borrar todas</button>` : ''}
      </div>
    </div>
    <section class="card notif-page">${lista.length ? lista.map(n => itemNotificacion(n, true)).join('') : vacio('No tienes notificaciones', 'Te avisaremos cuando tus reportes cambien de estado.', 'bell')}</section>`;
  }
};

/* ---------- Auxiliares de vistas ---------- */
function selectCampo(nombre, etiqueta, ic, opciones, valor, deshabilitado = false) {
  return `<label class="field"><span>${etiqueta}</span><div class="input-icon"><span>${icon(ic)}</span>
    <select name="${nombre}" ${deshabilitado ? 'disabled' : ''}>
      <option value="">${deshabilitado ? 'Primero completa el paso anterior' : 'Selecciona…'}</option>
      ${opciones.map(([v, t]) => `<option value="${esc(v)}" ${v === valor ? 'selected' : ''}>${esc(t)}</option>`).join('')}
    </select></div></label>`;
}
function filtroSelect(clave, etiqueta, opciones) {
  return `<label class="field"><span>${etiqueta}</span><select data-filter="${clave}">${opciones.map(([v, t]) => `<option value="${esc(v)}" ${state.filtros[clave] === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
}
function migas(r) {
  const partes = [r.edificio && edificioNombre(r.edificio), r.nivel && nivelNombre(r.edificio, r.nivel), r.espacio, r.activo].filter(Boolean);
  if (!partes.length) return `${icon('pin')}<span class="muted">Aún no seleccionas una ubicación</span>`;
  return icon('pin') + partes.map(esc).join(' <span class="sep">›</span> ');
}
function resumen(r) {
  const descOk = r.descripcion.trim().length >= 10;
  const filas = [
    ['Edificio', r.edificio ? edificioNombre(r.edificio) : '—'], ['Nivel', r.nivel ? nivelNombre(r.edificio, r.nivel) : '—'],
    ['Espacio', r.espacio || '—'], ['Activo', r.activo || '—'], ['Categoría', r.categoria || '—'],
    ['Severidad', r.severidad ? `${r.severidad} (SLA ${SEVERIDADES[r.severidad].sla} h)` : '—'],
    ['Fotografía', r.foto ? 'Adjunta' : 'Pendiente'], ['Descripción', descOk ? 'Lista' : 'Pendiente']
  ];
  const hechos = [r.edificio, r.nivel, r.espacio, r.activo, r.categoria, r.severidad, r.foto, descOk].filter(Boolean).length;
  const pct = Math.round(hechos / 8 * 100);
  return `<div class="sum-progress"><div class="bar"><i style="width:${pct}%"></i></div><small>${pct}% completado</small></div>
    ${filas.map(([k, v]) => `<div class="sum-row"><span>${k}</span><strong>${esc(v)}</strong></div>`).join('')}`;
}
function actualizarResumen() {
  const box = $('#resumenReporte');
  if (box) box.innerHTML = resumen(state.reporte);
}

function filtrarTickets(T, f) {
  const q = f.q.trim().toLowerCase();
  return T.filter(t => {
    if (f.tecnico === '__none' ? t.tecnico : (f.tecnico && t.tecnico !== f.tecnico)) return false;
    if (f.edificio && t.ubicacion.edificio !== f.edificio) return false;
    if (f.severidad && t.severidad !== f.severidad) return false;
    if (f.estado === 'activos' && !esActivo(t)) return false;
    if (f.estado === 'demorados' && !estaDemorado(t)) return false;
    if (!['activos', 'todos', 'demorados'].includes(f.estado) && t.estado !== f.estado) return false;
    if (q) {
      const texto = [t.id, t.descripcion, t.ubicacion.espacio, t.ubicacion.activo, t.categoria, t.solicitante.name, tecnicoDe(t)].join(' ').toLowerCase();
      if (!texto.includes(q)) return false;
    }
    return true;
  });
}

function resultadosDashboard(s) {
  const lista = filtrarTickets(DB.tickets, state.filtros).sort(porPrioridad);
  const cabecera = `<div class="results-head"><h3>${lista.length} orden${lista.length === 1 ? '' : 'es'} encontrada${lista.length === 1 ? '' : 's'}</h3><span class="muted small">Actualizado ${fmtFecha(Date.now())}</span></div>`;
  if (!lista.length) return cabecera + vacio('Sin resultados', 'Ajusta los filtros para ver otras órdenes.', 'search');
  return cabecera + `
  <div class="table-wrap"><table class="table">
    <thead><tr><th>Folio</th><th>Ubicación</th><th>Categoría</th><th>Severidad</th><th>Estado</th><th>Técnico</th><th>SLA</th><th></th></tr></thead>
    <tbody>${lista.map(t => {
      const si = slaInfo(t);
      return `<tr class="${estaDemorado(t) ? 'is-late' : ''}">
        <td data-label="Folio"><div><button class="link" data-action="ver" data-id="${t.id}">${t.id}</button><small>${hace(t.createdAt)}</small></div></td>
        <td data-label="Ubicación"><div><strong>Edificio ${t.ubicacion.edificio}</strong><small>${esc(nivelNombre(t.ubicacion.edificio, t.ubicacion.nivel))} · ${esc(t.ubicacion.espacio)}</small></div></td>
        <td data-label="Categoría"><div>${esc(t.categoria)}<small>${esc(t.ubicacion.activo)}</small></div></td>
        <td data-label="Severidad">${sevChip(t.severidad)}</td>
        <td data-label="Estado">${estadoChip(t.estado)}</td>
        <td data-label="Técnico">${t.tecnico ? esc(tecnicoDe(t)) : '<span class="muted">Sin asignar</span>'}</td>
        <td data-label="SLA"><span class="sla sla-${si.cls}">${si.txt}</span></td>
        <td data-label="Acciones"><div class="row-actions">${botonesAccion(t, s, true)}<button class="btn btn-ghost btn-sm" data-action="ver" data-id="${t.id}" aria-label="Ver detalle">${icon('eye')}</button></div></td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

function barraEstados(T) {
  const total = Math.max(1, T.length);
  const conteo = ESTADOS.map(e => [e, T.filter(t => t.estado === e).length]);
  return `<div class="stack-bar">${conteo.map(([e, n]) => n ? `<i style="width:${n / total * 100}%;background:${COLOR_ESTADO[e]}" title="${e}: ${n}"></i>` : '').join('')}</div>
    <div class="legend">${conteo.map(([e, n]) => `<span><i style="background:${COLOR_ESTADO[e]}"></i>${e}<b>${n}</b></span>`).join('')}</div>`;
}

function mapaCalor(T) {
  const porCat = state.heatmap === 'categoria';
  const niveles = [...new Map(CATALOGO.flatMap(e => e.niveles).map(n => [n.id, n.nombre])).entries()];
  const cols = porCat ? Object.keys(CATEGORIAS) : niveles.map(n => n[0]);
  const nombreCol = c => porCat ? c : (niveles.find(n => n[0] === c)?.[1] || c);
  const matriz = CATALOGO.map(ed => cols.map(c => {
    if (!porCat && !ed.niveles.some(n => n.id === c)) return null;
    return T.filter(t => t.ubicacion.edificio === ed.id && (porCat ? t.categoria === c : t.ubicacion.nivel === c)).length;
  }));
  const max = Math.max(1, ...matriz.flat().filter(v => v != null));
  return `<div class="heatmap" style="--cols:${cols.length}">
    <div class="hm-row"><span></span>${cols.map(c => `<span class="hm-head">${nombreCol(c)}</span>`).join('')}</div>
    ${CATALOGO.map((ed, i) => `<div class="hm-row">
      <span class="hm-label">Edificio ${ed.id}<small>${esc(edCorto(ed))}</small></span>
      ${matriz[i].map((v, j) => v == null
        ? '<span class="hm-cell na">—</span>'
        : `<span class="hm-cell ${v / max > 0.55 ? 'hot' : ''}" style="--a:${(0.07 + 0.88 * v / max).toFixed(2)}" title="Edificio ${ed.id} · ${nombreCol(cols[j])}: ${v} reporte${v === 1 ? '' : 's'}">${v}</span>`).join('')}
    </div>`).join('')}
  </div>`;
}

/* =========================================================
   9. NOTIFICACIONES — RF-05
   ========================================================= */
let entregadas = new Set();

function misNotificaciones() {
  const s = Auth.sesion();
  return s ? DB.data.notifications.filter(n => n.to === s.email) : [];
}
function iconoNotif(titulo) {
  if (/Resuelto|listo/.test(titulo)) return 'checkCircle';
  if (/Rechazado/.test(titulo)) return 'ban';
  if (/En Proceso/.test(titulo)) return 'wrench';
  if (/Asignado/.test(titulo)) return 'user';
  if (/Nuev/.test(titulo)) return 'alert';
  if (/Cerrado/.test(titulo)) return 'shield';
  return 'bell';
}
function itemNotificacion(n, conBorrar = false) {
  const item = `<button class="notif-item ${n.read ? '' : 'unread'}" data-action="notif-open" data-id="${n.id}">
    <span class="notif-ic">${icon(iconoNotif(n.title))}</span>
    <span><strong>${esc(n.title)}</strong><p>${esc(n.body)}</p><small>${hace(n.at)}</small></span></button>`;
  if (!conBorrar) return item;
  return `<div class="notif-row">${item}<button class="icon-btn notif-del" data-action="notif-del" data-id="${n.id}" aria-label="Eliminar notificación">${icon('trash')}</button></div>`;
}
function botonPush() {
  if (!('Notification' in window)) return '';
  if (Notification.permission === 'granted') return `<span class="pill" style="background:var(--g100);color:var(--g800)">${icon('check')} Avisos del sistema activos</span>`;
  if (Notification.permission === 'denied') return '<span class="muted small">Avisos del sistema bloqueados en el navegador</span>';
  return `<button class="btn btn-primary btn-sm" data-action="push-permiso">${icon('bell')} Activar notificaciones push</button>`;
}
function renderPanel() {
  const lista = misNotificaciones();
  const pedirPush = ('Notification' in window) && Notification.permission === 'default';
  $('#notifPanel').innerHTML = `
    <div class="np-head"><strong>Notificaciones</strong><button class="link small" data-action="notif-all-read">Marcar como leídas</button></div>
    ${pedirPush ? `<div class="push-banner">${icon('bell')}<span>Activa los avisos push para enterarte al instante.</span><button class="btn btn-sm btn-light" data-action="push-permiso">Activar</button></div>` : ''}
    <div class="np-list">${lista.length ? lista.slice(0, 8).map(n => itemNotificacion(n)).join('') : '<p class="empty small">Sin notificaciones</p>'}</div>
    <div class="np-foot"><button class="btn btn-sm btn-ghost" data-action="nav" data-view="notificaciones">Ver todas</button></div>`;
}
function actualizarContadores() {
  const s = Auth.sesion();
  if (!s) return;
  const sinLeer = misNotificaciones().filter(n => !n.read).length;
  const badge = $('#bellCount');
  badge.hidden = !sinLeer;
  badge.textContent = sinLeer > 9 ? '9+' : sinLeer;
  const T = DB.tickets;
  const conteos = {
    'mis-tickets': T.filter(t => t.solicitante.email === s.email && (esActivo(t) || t.estado === 'Resuelto')).length,
    tareas: T.filter(t => t.tecnico === s.email && esActivo(t)).length,
    dashboard: T.filter(t => t.estado === 'Abierto').length,
    notificaciones: sinLeer
  };
  $$('[data-count]').forEach(el => {
    const n = conteos[el.dataset.count] || 0;
    el.hidden = !n;
    el.textContent = n > 9 ? '9+' : n;
  });
  if (!$('#notifPanel').hidden) renderPanel();
}
function iniciarEntregas(s) {
  entregadas = new Set(DB.data.notifications.filter(n => n.to === s.email).map(n => n.id));
}
/* Muestra como aviso emergente y notificación del sistema lo que llegó para el usuario actual */
function entregarNotificaciones() {
  const s = Auth.sesion();
  if (!s) return;
  const nuevas = DB.data.notifications.filter(n => n.to === s.email && !entregadas.has(n.id)).reverse();
  nuevas.forEach(n => {
    entregadas.add(n.id);
    toast(n.title, n.body, 'info', n.ticketId);
    notificacionSistema(n);
  });
  actualizarContadores();
}
function notificacionSistema(n) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (typeof PWA !== 'undefined' && PWA.pushActivo) return; // el Service Worker ya muestra el aviso push
    const aviso = new Notification(`CampusCare · ${n.title}`, { body: n.body, icon: 'img/logo.png', tag: n.id });
    aviso.onclick = () => { window.focus(); abrirDetalle(n.ticketId); aviso.close(); };
  } catch { /* algunos navegadores móviles requieren service worker */ }
}

/* =========================================================
   10. MODALES
   ========================================================= */
function abrirModal(html, ancho = false) {
  const card = $('.modal-card');
  $('#modalBody').innerHTML = html;
  card.classList.toggle('wide', ancho);
  $('#modal').hidden = false;
  document.body.classList.add('no-scroll');
}
function cerrarModal() {
  $('#modal').hidden = true;
  $('#modalBody').innerHTML = '';
  state.modal = null;
  document.body.classList.remove('no-scroll');
}

function abrirDetalle(id, refrescar = false) {
  const t = DB.ticket(id);
  const s = Auth.sesion();
  if (!t || !s) { if (!refrescar) toast('Ticket no encontrado', 'Es posible que se haya restablecido la demo.', 'error'); return; }
  const card = $('.modal-card');
  const scroll = card.scrollTop;
  state.modal = { tipo: 'detalle', id };
  const c = catDe(t.categoria);
  const si = slaInfo(t);
  const acciones = botonesAccion(t, s) + (s.role === 'admin' ? `<button class="btn btn-danger" data-action="eliminar" data-id="${t.id}">${icon('trash')} Eliminar ticket</button>` : '');
  abrirModal(`
    <div class="detail-hero cat-${slug(t.categoria)}" style="${bgImg(t.foto || c.img)}">
      <div class="detail-hero-in">
        <span class="folio folio-light">${t.id} · ${fmtFecha(t.createdAt)}</span>
        <h3>${esc(t.categoria)} · ${esc(t.ubicacion.activo)}</h3>
        <div class="chip-row">${estadoChip(t.estado)}${sevChip(t.severidad)}</div>
      </div>
    </div>
    <div class="detail-body">
      ${progreso(t)}
      <div class="info-grid">
        <div><small>Ubicación</small><strong>${esc(edificioNombre(t.ubicacion.edificio))}</strong><span>${esc(nivelNombre(t.ubicacion.edificio, t.ubicacion.nivel))} · ${esc(t.ubicacion.espacio)}</span></div>
        <div><small>Solicitante</small><strong>${esc(t.solicitante.name)}</strong><span>${esc(t.solicitante.email)}</span></div>
        <div><small>Técnico responsable</small><strong>${t.tecnico ? esc(tecnicoDe(t)) : 'Sin asignar'}</strong><span>${t.tecnico ? esc(t.tecnico) : 'Pendiente de asignación'}</span></div>
        <div><small>SLA · máximo ${SEVERIDADES[t.severidad].sla} h</small><strong class="sla-${si.cls}">${si.txt}</strong><div class="bar"><i style="width:${si.pct}%"></i></div></div>
      </div>
      <h4>Descripción</h4>
      <p>${esc(t.descripcion)}</p>
      ${t.foto ? '' : '<p class="tiny muted">Registro de demostración sin fotografía original; se muestra una imagen de referencia de la categoría.</p>'}
      ${t.rechazo ? `<div class="alert alert-error"><strong>Motivo de rechazo:</strong> ${esc(t.rechazo)}</div>` : ''}
      ${t.resolucion ? `
        <div class="resolution">
          <h4>${icon('checkCircle')} Evidencia de solución</h4>
          <div class="resolution-grid">
            <div class="resolution-photo">${t.resolucion.foto ? `<img src="${t.resolucion.foto}" alt="Evidencia del trabajo">` : `${thumb(t)}<span class="demo-tag">Imagen de referencia</span>`}</div>
            <div>
              <small>Notas técnicas</small><p>${esc(t.resolucion.notas)}</p>
              <small>Materiales / refacciones</small><p>${esc(t.resolucion.materiales)}</p>
              <small>Fecha de resolución</small><p>${fmtFecha(t.resolucion.at)} · ${fmtHoras(tiempoResolucion(t))} desde el reporte</p>
            </div>
          </div>
        </div>` : ''}
      <h4>Trazabilidad del ticket</h4>
      <ol class="timeline">${t.historial.slice().reverse().map(h => `
        <li class="tl-${slug(h.a)}"><span class="tl-dot"></span>
          <div><strong>${h.de ? `${esc(h.de)} → ` : ''}${esc(h.a)}</strong><small>${esc(h.porNombre)} · ${fmtFecha(h.at)}</small>${h.nota ? `<p>${esc(h.nota)}</p>` : ''}</div>
        </li>`).join('')}</ol>
      ${acciones ? `<div class="modal-actions">${acciones}</div>` : ''}
    </div>`, true);
  if (refrescar) card.scrollTop = scroll; else card.scrollTop = 0;
}

function abrirAsignar(id) {
  const t = DB.ticket(id);
  state.modal = { tipo: 'asignar', id };
  const tecnicos = USUARIOS.filter(u => u.role === 'mantenimiento');
  abrirModal(`
    <form class="modal-pad" data-form="asignar" data-id="${id}" novalidate>
      <div class="modal-head"><span class="stat-ic">${icon('user')}</span><div><h3>Asignar técnico</h3><p class="muted small">${t.id} · ${esc(t.categoria)} · ${esc(ubicTexto(t))}</p></div></div>
      <div class="tech-list">${tecnicos.map((tc, i) => {
        const carga = DB.tickets.filter(x => x.tecnico === tc.email && esActivo(x)).length;
        return `<label class="tech-option"><input type="radio" name="tecnico" value="${tc.email}" ${i === 0 ? 'checked' : ''}>
          <span class="avatar">${avatarHTML(tc)}</span><span class="grow"><strong>${esc(tc.name)}</strong><small>${carga} orden${carga === 1 ? '' : 'es'} activa${carga === 1 ? '' : 's'}</small></span></label>`;
      }).join('')}</div>
      <label class="field"><span>Indicaciones para el técnico (opcional)</span><textarea name="nota" rows="3" placeholder="Ej. Llevar escalera y multímetro."></textarea></label>
      <div class="alert alert-error" hidden></div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Cancelar</button><button type="submit" class="btn btn-primary">${icon('check')} Asignar</button></div>
    </form>`);
}

function abrirRechazar(id) {
  const t = DB.ticket(id);
  state.modal = { tipo: 'rechazar', id };
  const motivos = ['Reporte duplicado', 'Fuera del alcance de mantenimiento', 'Información insuficiente', 'Ya existe una obra programada'];
  abrirModal(`
    <form class="modal-pad" data-form="rechazar" data-id="${id}" novalidate>
      <div class="modal-head"><span class="stat-ic" style="background:linear-gradient(135deg,#7f1d1d,#ef4444)">${icon('ban')}</span><div><h3>Rechazar ticket</h3><p class="muted small">${t.id} · ${esc(t.categoria)} · ${esc(ubicTexto(t))}</p></div></div>
      <div class="quick-reasons">${motivos.map(m => `<button type="button" class="fchip" data-action="motivo" data-text="${esc(m)}">${esc(m)}</button>`).join('')}</div>
      <label class="field"><span>Motivo del rechazo</span><textarea name="motivo" rows="3" placeholder="Explica al solicitante por qué se rechaza."></textarea></label>
      <div class="alert alert-error" hidden></div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Cancelar</button><button type="submit" class="btn btn-danger">${icon('ban')} Rechazar ticket</button></div>
    </form>`);
}

/* RF-04: formulario de cierre con evidencia obligatoria */
function abrirResolver(id) {
  const t = DB.ticket(id);
  state.modal = { tipo: 'resolver', id };
  state.resolucion = { foto: '' };
  abrirModal(`
    <form class="modal-pad" data-form="resolver" data-id="${id}" novalidate>
      <div class="modal-head"><span class="stat-ic">${icon('checkCircle')}</span><div><h3>Registrar solución</h3><p class="muted small">${t.id} · ${esc(t.categoria)} · ${esc(ubicTexto(t))}</p></div></div>
      <div class="field"><span>Fotografía del trabajo concluido *</span><div class="photo-zone">${photoZoneInner('', 'evidencia')}</div></div>
      <label class="field"><span>Notas técnicas de la solución *</span><textarea name="notas" rows="3" placeholder="Describe qué se hizo y cómo se verificó."></textarea></label>
      <label class="field"><span>Materiales o refacciones utilizados *</span><input type="text" name="materiales" placeholder="Ej. 2 lámparas LED 18 W, cinta aislante (o &quot;Ninguno&quot;)"></label>
      <div class="alert alert-error" hidden></div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Cancelar</button><button type="submit" class="btn btn-primary">${icon('check')} Marcar como resuelto</button></div>
    </form>`);
}

/* =========================================================
   11. AVISOS EMERGENTES
   ========================================================= */
function toast(titulo, mensaje = '', tipo = 'success', ticketId) {
  const el = document.createElement('div');
  el.className = `toast ${tipo}`;
  el.innerHTML = `<span class="toast-ic">${icon(tipo === 'error' ? 'alert' : tipo === 'info' ? 'bell' : 'checkCircle')}</span>
    <div><strong>${esc(titulo)}</strong>${mensaje ? `<p>${esc(mensaje)}</p>` : ''}</div>`;
  if (ticketId) {
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => { if (Auth.sesion()) abrirDetalle(ticketId); el.remove(); });
  }
  $('#toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, tipo === 'error' ? 6000 : 4500);
}

/* =========================================================
   12. NAVEGACIÓN Y RENDERIZADO
   ========================================================= */
function renderShell(s) {
  const vistas = ROLES[s.role].vistas;
  $('#sideNav').innerHTML = vistas.map(v => `
    <button class="nav-item" data-action="nav" data-view="${v}">${icon(VISTAS[v].icono)}<span>${VISTAS[v].titulo}</span><span class="nav-count" data-count="${v}" hidden></span></button>`).join('');
  const movil = ROLES[s.role].movil || vistas;
  const bn = $('#bottomNav');
  bn.style.setProperty('--n', movil.length);
  bn.innerHTML = movil.map(v => `
    <button class="bnav-item ${v === 'reportar' ? 'primary' : ''}" data-action="nav" data-view="${v}"><span class="bnav-ic">${icon(VISTAS[v].icono)}</span><span>${VISTAS[v].corto}</span><span class="bnav-count" data-count="${v}" hidden></span></button>`).join('');
  $('#sideRole').textContent = ROLES[s.role].label;
  $('#userName').textContent = s.name;
  $('#userRole').textContent = ROLES[s.role].label;
  $('#userAvatar').innerHTML = avatarHTML(s);
}

function renderVista() {
  const s = Auth.sesion();
  if (!s) { cerrarSesion(true); return; }
  const v = state.vista;
  $('#viewTitle').textContent = VISTAS[v].titulo;
  $('#viewKicker').textContent = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
  $$('#sideNav [data-view], #bottomNav [data-view]').forEach(b => b.classList.toggle('is-active', b.dataset.view === v));
  $('#view').innerHTML = RENDER[v](s);
  actualizarContadores();
  POST_RENDER[v]?.(s);
}

function navegar(v) {
  const s = Auth.sesion();
  if (!s) { cerrarSesion(true); return; }
  if (!ROLES[s.role].vistas.includes(v)) v = 'inicio';
  state.vista = v;
  if (location.hash.slice(1) !== v) history.replaceState(null, '', `#${v}`);
  $('#notifPanel').hidden = true;
  renderVista();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function entrarApp(s) {
  $('#login').hidden = true;
  $('#app').hidden = false;
  renderShell(s);
  $('#view').innerHTML = `<section class="card">${vacio('Cargando información…', 'Conectando con la base de datos.', 'database')}</section>`;
  try {
    s = await Auth.refrescar();
    await DB.sync();
  } catch (err) {
    if (!Auth.sesion()) return;
    toast('Sin conexión con el servidor', err.message, 'error');
  }
  renderShell(s);
  iniciarEntregas(s);
  conectarEventos();
  if (typeof sincronizarPush === 'function') sincronizarPush();
  const v = location.hash.slice(1);
  navegar(ROLES[s.role].vistas.includes(v) ? v : 'inicio');
}

function mostrarLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
  actualizarHeroStats();
}

function cerrarSesion(expirada = false) {
  desconectarEventos();
  if (typeof limpiarCacheApi === 'function') limpiarCacheApi(); // borra datos personales guardados por el Service Worker
  if (typeof pushAlCerrarSesion === 'function' && !expirada) pushAlCerrarSesion();
  Auth.logout();
  cerrarModal();
  state.filtros = filtrosIniciales();
  state.reporte = nuevoReporte();
  history.replaceState(null, '', location.pathname + location.search);
  mostrarLogin();
  if (expirada) toast('Sesión finalizada', 'Tu token expiró. Vuelve a iniciar sesión.', 'info');
}

async function actualizarHeroStats() {
  try {
    const r = await api('/publico/resumen');
    $('#heroStat1').textContent = r.atendidos;
    $('#heroStat2').textContent = `${r.sla}%`;
    $('#heroStat3').textContent = r.edificios;
  } catch { /* servidor apagado: se dejan los valores por defecto */ }
}

/* =========================================================
   13. ACCIONES (botones con data-action)
   ========================================================= */
const ACCIONES = {
  nav: (id, el) => navegar(el.dataset.view),
  ver: id => abrirDetalle(id),
  asignar: id => abrirAsignar(id),
  rechazar: id => abrirRechazar(id),
  resolver: id => abrirResolver(id),
  iniciar: async id => {
    await Tickets.transicion(id, 'En Proceso');
    toast('Trabajo iniciado', `${id} ahora está En Proceso. Se notificó al solicitante.`);
  },
  cerrar: async id => {
    if (!confirm(`¿Cerrar definitivamente el ticket ${id}?`)) return;
    const s = Auth.sesion();
    await Tickets.transicion(id, 'Cerrado', { nota: s.role === 'solicitante' ? 'El solicitante confirmó la solución' : 'Validado y cerrado por administración' });
    toast('Ticket cerrado', `${id} quedó cerrado con su trazabilidad completa.`);
  },
  cancelar: async id => {
    if (!confirm(`¿Cancelar el reporte ${id}? Se eliminará de la base de datos junto con su historial.`)) return;
    await Tickets.eliminar(id);
    if (state.modal?.id === id) cerrarModal();
    toast('Reporte cancelado', `${id} se eliminó de la base de datos.`);
  },
  eliminar: async id => {
    if (!confirm(`¿Eliminar el ticket ${id}? También se borrarán su historial, su evidencia y sus notificaciones.`)) return;
    await Tickets.eliminar(id);
    cerrarModal();
    toast('Ticket eliminado', `${id} se eliminó de la base de datos.`);
  },
  edificio: id => {
    const s = Auth.sesion();
    if (s.role === 'admin') { state.filtros = { ...filtrosIniciales(), edificio: id, estado: 'todos' }; navegar('dashboard'); }
    else if (s.role === 'solicitante') { state.reporte = { ...nuevoReporte(), edificio: id }; navegar('reportar'); }
    else navegar('tareas');
  },
  'filtro-mis': (id, el) => { state.filtroMis = el.dataset.f; renderVista(); },
  tab: (id, el) => { state.tabTareas = el.dataset.tab; renderVista(); },
  periodo: (id, el) => { state.periodo = el.dataset.p; renderVista(); },
  heatmap: (id, el) => { state.heatmap = el.dataset.m; renderVista(); },
  kpi: (id, el) => {
    state.filtros = { ...filtrosIniciales(), estado: el.dataset.estado };
    renderVista();
    $('#dashResults')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  'reset-filtros': () => { state.filtros = filtrosIniciales(); renderVista(); },
  'export-csv': exportarCSV,
  'limpiar-reporte': () => { state.reporte = nuevoReporte(); renderVista(); },
  'quitar-foto': (id, el) => {
    const campo = el.dataset.field;
    if (campo === 'foto') { state.reporte.foto = ''; actualizarResumen(); } else state.resolucion.foto = '';
    const zona = el.closest('.photo-zone');
    zona.classList.remove('has-photo');
    zona.innerHTML = photoZoneInner('', campo);
  },
  motivo: (id, el) => { const ta = $('[name=motivo]'); if (ta) { ta.value = el.dataset.text; ta.focus(); } },
  'toggle-bell': () => {
    const panel = $('#notifPanel');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) renderPanel();
  },
  'notif-open': id => {
    const n = DB.data.notifications.find(x => x.id === id);
    if (!n) return;
    if (!n.read) {
      n.read = true;
      api(`/notificaciones/${id}/leida`, { method: 'PATCH' }).catch(() => {});
    }
    $('#notifPanel').hidden = true;
    Bus.emit('data');
    if (n.ticketId) abrirDetalle(n.ticketId);
  },
  'notif-all-read': async () => {
    await api('/notificaciones/leer-todas', { method: 'POST' });
    await sincronizar();
  },
  'notif-del': async id => {
    await api(`/notificaciones/${id}`, { method: 'DELETE' });
    await sincronizar();
    toast('Notificación eliminada', 'Se borró de la base de datos.');
  },
  'notif-del-all': async () => {
    if (!confirm('¿Borrar todas tus notificaciones de la base de datos?')) return;
    const r = await api('/notificaciones', { method: 'DELETE' });
    await sincronizar();
    toast('Notificaciones borradas', `${r.eliminadas} registro(s) eliminados.`);
  },
  'push-permiso': async () => {
    await activarPush(); // suscripción real a Web Push (pwa.js)
    toast('Notificaciones push activadas', 'Recibirás avisos en este dispositivo aunque la app esté cerrada.');
    renderPanel();
    if (state.vista === 'notificaciones') renderVista();
  },
  logout: () => cerrarSesion(false),
  demo: (id, el) => {
    $('#loginEmail').value = el.dataset.email;
    $('#loginPass').value = DEMO_PASSWORD;
    $('#loginForm').requestSubmit();
  },
  'toggle-pass': (id, el) => {
    const input = $('#loginPass');
    const ver = input.type === 'password';
    input.type = ver ? 'text' : 'password';
    el.innerHTML = icon(ver ? 'eyeOff' : 'eye');
  },
  'mostrar-registro': () => {
    $('#loginForm').hidden = true;
    $('#registroForm').hidden = false;
    $('#regNombre').focus();
  },
  'mostrar-login': () => {
    $('#registroForm').hidden = true;
    $('#loginForm').hidden = false;
    $('#loginEmail').focus();
  }
};

function exportarCSV() {
  const lista = filtrarTickets(DB.tickets, state.filtros).sort(porPrioridad);
  const cabecera = ['Folio', 'Fecha', 'Edificio', 'Nivel', 'Espacio', 'Activo', 'Categoría', 'Severidad', 'Estado', 'Técnico', 'Solicitante', 'Horas transcurridas', 'SLA (h)', 'Estatus SLA'];
  const filas = lista.map(t => {
    const fin = t.resolucion ? t.resolucion.at : Date.now();
    return [t.id, new Date(t.createdAt).toLocaleString('es-MX'), edificioNombre(t.ubicacion.edificio), nivelNombre(t.ubicacion.edificio, t.ubicacion.nivel),
      t.ubicacion.espacio, t.ubicacion.activo, t.categoria, t.severidad, t.estado, tecnicoDe(t) || 'Sin asignar', t.solicitante.name,
      ((fin - t.createdAt) / HORA).toFixed(1), SEVERIDADES[t.severidad].sla, slaInfo(t).txt];
  });
  const csv = '\ufeff' + [cabecera, ...filas].map(f => f.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `reporte-estatus-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Reporte exportado', `${lista.length} órdenes en formato CSV (se abre en Excel).`);
}

/* =========================================================
   14. FORMULARIOS
   ========================================================= */
const FORMULARIOS = {
  async reporte(form) {
    const datos = { ...state.reporte, descripcion: form.descripcion.value };
    const t = await Tickets.crear(datos);
    state.reporte = nuevoReporte();
    toast('Reporte enviado', `Tu folio es ${t.id}. Te avisaremos en cada cambio de estado.`);
    const s = Auth.sesion();
    navegar(s.role === 'admin' ? 'dashboard' : 'mis-tickets');
    abrirDetalle(t.id);
  },
  async asignar(form) {
    const id = form.dataset.id;
    const tecnico = form.tecnico.value;
    const nota = form.nota.value.trim();
    await Tickets.transicion(id, 'Asignado', { tecnico, nota: nota ? `Asignado a ${nombreDe(tecnico)}. Indicaciones: ${nota}` : '' });
    cerrarModal();
    toast('Técnico asignado', `${id} se asignó a ${nombreDe(tecnico)}. Ambos recibieron una notificación.`);
  },
  async rechazar(form) {
    const id = form.dataset.id;
    await Tickets.transicion(id, 'Rechazado', { motivo: form.motivo.value });
    cerrarModal();
    toast('Ticket rechazado', `Se notificó al solicitante de ${id}.`);
  },
  async resolver(form) {
    const id = form.dataset.id;
    await Tickets.transicion(id, 'Resuelto', { foto: state.resolucion.foto, notas: form.notas.value, materiales: form.materiales.value });
    state.resolucion = { foto: '' };
    cerrarModal();
    toast('Ticket resuelto', `La evidencia de ${id} quedó registrada y se notificó al solicitante.`);
  }
};

/* =========================================================
   15. EVENTOS GLOBALES
   ========================================================= */
document.addEventListener('click', async e => {
  if (!e.target.closest('.bell-wrap')) $('#notifPanel').hidden = true;
  if (e.target.closest('[data-close]')) { cerrarModal(); return; }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const accion = ACCIONES[el.dataset.action];
  if (!accion) return;
  try { await accion(el.dataset.id, el, e); }
  catch (err) { toast('No se pudo completar', err.message, 'error'); }
});

document.addEventListener('submit', async e => {
  const form = e.target;
  e.preventDefault();
  const boton = form.querySelector('[type=submit]');
  if (boton?.disabled) return;
  if (boton) boton.disabled = true;
  try {
    if (form.id === 'loginForm' || form.id === 'registroForm') {
      const error = form.querySelector('.alert-error');
      try {
        let s;
        if (form.id === 'loginForm') {
          s = await Auth.login($('#loginEmail').value, $('#loginPass').value);
        } else {
          if ($('#regPass').value !== $('#regPass2').value) throw new Error('Las contraseñas no coinciden.');
          s = await Auth.registro({ nombre: $('#regNombre').value, correo: $('#regEmail').value, password: $('#regPass').value });
        }
        error.hidden = true;
        form.reset();
        await entrarApp(s);
        toast(`Bienvenido(a), ${primerNombre(s.name)}`, form.id === 'registroForm' ? 'Tu cuenta se registró en la base de datos.' : `Sesión iniciada como ${ROLES[s.role].label}.`);
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
      }
      return;
    }
    const manejador = FORMULARIOS[form.dataset.form];
    if (!manejador) return;
    const caja = form.querySelector('.alert-error');
    try {
      if (caja) caja.hidden = true;
      await manejador(form);
    } catch (err) {
      if (caja) { caja.textContent = err.message; caja.hidden = false; caja.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
      else toast('Revisa la información', err.message, 'error');
    }
  } finally {
    if (boton && boton.isConnected) boton.disabled = false;
  }
});

document.addEventListener('change', e => {
  const el = e.target;

  // Fotografías (reporte y evidencia de cierre)
  if (el.matches('input[data-photo]')) {
    const archivo = el.files[0];
    if (!archivo) return;
    const zona = el.closest('.photo-zone');
    const campo = el.dataset.photo;
    zona.classList.add('loading');
    comprimirImagen(archivo)
      .then(foto => {
        if (campo === 'foto') { state.reporte.foto = foto; actualizarResumen(); } else state.resolucion.foto = foto;
        zona.classList.add('has-photo');
        zona.innerHTML = photoZoneInner(foto, campo);
      })
      .catch(err => toast('Imagen no válida', err.message, 'error'))
      .finally(() => zona.classList.remove('loading'));
    return;
  }

  // Filtros del dashboard
  if (el.matches('select[data-filter]')) {
    state.filtros[el.dataset.filter] = el.value;
    renderVista();
    return;
  }

  // Menús jerárquicos del reporte (Edificio → Nivel → Espacio → Activo)
  if (el.closest('[data-form="reporte"]')) {
    const r = state.reporte;
    const siguiente = { edificio: 'nivel', nivel: 'espacio', espacio: 'activo' };
    if (el.name === 'edificio') { r.edificio = el.value; r.nivel = r.espacio = r.activo = ''; }
    else if (el.name === 'nivel') { r.nivel = el.value; r.espacio = r.activo = ''; }
    else if (el.name === 'espacio') { r.espacio = el.value; r.activo = ''; }
    else if (el.name === 'activo') { r.activo = el.value; $('#ubicPreview').innerHTML = migas(r); actualizarResumen(); return; }
    else if (el.name === 'categoria' || el.name === 'severidad') {
      r[el.name] = el.value;
      $$(`[name="${el.name}"]`).forEach(i => i.closest('label').classList.toggle('is-on', i.checked));
      actualizarResumen();
      return;
    } else return;
    renderVista();
    if (el.value) $(`[name="${siguiente[el.name]}"]`)?.focus();
  }
});

let temporizadorBusqueda;
document.addEventListener('input', e => {
  const el = e.target;
  if (el.matches('input[data-filter="q"]')) {
    state.filtros.q = el.value;
    clearTimeout(temporizadorBusqueda);
    temporizadorBusqueda = setTimeout(() => { const box = $('#dashResults'); if (box) box.innerHTML = resultadosDashboard(Auth.sesion()); }, 200);
  }
  if (el.name === 'descripcion' && el.closest('[data-form="reporte"]')) {
    state.reporte.descripcion = el.value;
    $('#descCount').textContent = el.value.length;
    actualizarResumen();
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#modal').hidden) cerrarModal();
});

window.addEventListener('hashchange', () => {
  const v = location.hash.slice(1);
  if (v && v !== state.vista && Auth.sesion()) navegar(v);
});

/* Al cambiar los datos se refrescan la vista y el detalle abierto */
Bus.on('data', () => {
  if (!Auth.sesion() || $('#app').hidden) return;
  actualizarContadores();
  const escribiendo = isTyping() && $('#view').contains(document.activeElement);
  if (state.vista !== 'reportar' && !escribiendo) renderVista();
  if (state.modal?.tipo === 'detalle') abrirDetalle(state.modal.id, true);
});

/* Revisión periódica: expiración del token y tiempos de SLA */
setInterval(() => {
  if ($('#app').hidden) return;
  if (!Auth.sesion()) { cerrarSesion(true); return; }
  if (['dashboard', 'tareas', 'inicio', 'mis-tickets'].includes(state.vista) && $('#modal').hidden && !isTyping()) renderVista();
}, 60000);

/* =========================================================
   16. ARRANQUE
   ========================================================= */
async function iniciar() {
  $$('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
  const s = Auth.sesion();
  if (s) await entrarApp(s); else mostrarLogin();
}
iniciar();
