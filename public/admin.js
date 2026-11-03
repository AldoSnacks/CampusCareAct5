/* =========================================================
   CampusCare · admin.js
   Vistas exclusivas del Administrador:
   - Usuarios: alta, edición, activación y baja de cuentas
   - Catálogo del campus: edificios, niveles, espacios,
     categorías y SLA por severidad
   - Base de datos: ver, agregar, editar y eliminar registros
     de cualquier tabla, consola SQL y respaldo
   Se carga después de app.js y usa sus funciones.
   ========================================================= */
'use strict';

const ADM = {
  usuarios: null,
  filtroRol: 'todos',
  buscarUsuario: '',
  catTab: 'ubicaciones',
  tablas: null,
  tabla: 'tickets',
  datos: null,
  pagina: 1,
  buscar: '',
  verSql: false,
  consulta: { sql: 'SELECT folio, estado, severidad, edificio, espacio, solicitante, tecnico, sla\nFROM vista_reporte_tickets\nORDER BY creado_en DESC', resultado: null, error: '' }
};

const ROL_INFO = {
  solicitante:   { label: 'Alumno / Docente', cls: 'rol-sol' },
  mantenimiento: { label: 'Mantenimiento',    cls: 'rol-man' },
  admin:         { label: 'Administrador',    cls: 'rol-adm' }
};
const ICONOS_CAT = ['zap', 'chair', 'wifi', 'drop', 'building', 'box', 'wrench', 'shield', 'layers', 'door', 'alert', 'info'];
const fmtDia = ms => ms ? new Date(ms).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const cargando = txt => `<div class="empty">${icon('database')}<strong>${txt}</strong><p class="small">Consultando la base de datos…</p></div>`;
const rolChip = r => `<span class="chip ${ROL_INFO[r]?.cls || ''}">${ROL_INFO[r]?.label || esc(r)}</span>`;

function refrescarAdmin() {
  document.activeElement?.blur?.();
  renderVista();
}

/* =========================================================
   USUARIOS
   ========================================================= */
RENDER.usuarios = () => {
  const lista = ADM.usuarios || [];
  const filtros = [['todos', 'Todos'], ['solicitante', 'Alumno / Docente'], ['mantenimiento', 'Mantenimiento'], ['admin', 'Administrador']];
  return `
  <div class="toolbar">
    <div class="chip-filters">${filtros.map(([k, l]) => `<button class="fchip ${ADM.filtroRol === k ? 'is-on' : ''}" data-action="u-filtro" data-f="${k}">${l}<b>${k === 'todos' ? lista.length : lista.filter(u => u.rol === k).length}</b></button>`).join('')}</div>
    <div class="btn-row">
      <div class="input-icon search-sm"><span>${icon('search')}</span><input type="search" data-adm-buscar="usuarios" value="${esc(ADM.buscarUsuario)}" placeholder="Buscar nombre o correo"></div>
      <button class="btn btn-primary" data-action="u-nuevo">${icon('plus')} Nuevo usuario</button>
    </div>
  </div>
  <section class="card" id="admUsuarios">${ADM.usuarios ? tablaUsuarios() : cargando('Cargando usuarios')}</section>
  <p class="tiny muted">Las contraseñas se guardan cifradas con bcrypt (columna <code>password_hash</code>). Al eliminar un usuario también se eliminan, en cascada, sus reportes y notificaciones.</p>`;
};

function tablaUsuarios() {
  const s = Auth.sesion();
  const q = ADM.buscarUsuario.trim().toLowerCase();
  const lista = ADM.usuarios.filter(u => (ADM.filtroRol === 'todos' || u.rol === ADM.filtroRol) && (!q || `${u.nombre} ${u.correo}`.toLowerCase().includes(q)));
  if (!lista.length) return vacio('Sin usuarios', 'No hay cuentas que coincidan con el filtro.', 'users');
  return `<div class="table-wrap"><table class="table users-table">
    <thead><tr><th>ID</th><th>Usuario</th><th>Rol</th><th>Estado</th><th>Reportes</th><th>Asignados</th><th>Alta</th><th>Último acceso</th><th>Acciones</th></tr></thead>
    <tbody>${lista.map(u => {
      const yo = u.id === s.id;
      return `<tr class="${u.activo ? '' : 'is-off'}">
        <td data-label="ID"><code>${u.id}</code></td>
        <td data-label="Usuario"><div class="user-cell"><span class="avatar">${avatarHTML({ name: u.nombre, avatar: u.avatar })}</span><div><strong>${esc(u.nombre)}${yo ? ' <small class="you">(tú)</small>' : ''}</strong><small>${esc(u.correo)}</small></div></div></td>
        <td data-label="Rol">${rolChip(u.rol)}</td>
        <td data-label="Estado"><span class="chip ${u.activo ? 'st-resuelto' : 'st-rechazado'}">${u.activo ? 'Activo' : 'Inactivo'}</span></td>
        <td data-label="Reportes">${u.reportes}</td>
        <td data-label="Asignados">${u.asignados}</td>
        <td data-label="Alta">${fmtDia(u.creado_en)}</td>
        <td data-label="Último acceso">${u.ultimo_acceso ? hace(u.ultimo_acceso) : '<span class="muted">Nunca</span>'}</td>
        <td data-label="Acciones"><div class="row-actions">
          <button class="btn btn-ghost btn-sm" data-action="u-editar" data-id="${u.id}" title="Editar" aria-label="Editar">${icon('edit')}</button>
          ${yo ? '' : `<button class="btn btn-ghost btn-sm" data-action="u-activo" data-id="${u.id}" title="${u.activo ? 'Desactivar cuenta' : 'Activar cuenta'}" aria-label="${u.activo ? 'Desactivar' : 'Activar'}">${icon(u.activo ? 'ban' : 'checkCircle')}</button>
          <button class="btn btn-danger btn-sm" data-action="u-eliminar" data-id="${u.id}" aria-label="Eliminar">${icon('trash')}</button>`}
        </div></td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
}

POST_RENDER.usuarios = async () => {
  try {
    ADM.usuarios = await api('/usuarios');
    if (state.vista !== 'usuarios') return;
    const caja = $('#admUsuarios');
    if (caja) caja.innerHTML = tablaUsuarios();
    $$('.chip-filters [data-action="u-filtro"] b').forEach((b, i) => {
      const k = ['todos', 'solicitante', 'mantenimiento', 'admin'][i];
      b.textContent = k === 'todos' ? ADM.usuarios.length : ADM.usuarios.filter(u => u.rol === k).length;
    });
  } catch (err) {
    const caja = $('#admUsuarios');
    if (caja) caja.innerHTML = vacio('No se pudo cargar', esc(err.message), 'alert');
  }
};

function abrirUsuario(u) {
  const nuevo = !u;
  state.modal = { tipo: 'usuario' };
  abrirModal(`
    <form class="modal-pad" data-form="usuario" ${nuevo ? '' : `data-id="${u.id}"`} novalidate>
      <div class="modal-head"><span class="stat-ic">${icon(nuevo ? 'plus' : 'edit')}</span><div><h3>${nuevo ? 'Nuevo usuario' : 'Editar usuario'}</h3><p class="muted small">${nuevo ? 'Se agregará un registro a la tabla usuarios.' : `Registro #${u.id} de la tabla usuarios.`}</p></div></div>
      <label class="field"><span>Nombre completo *</span><input type="text" name="nombre" maxlength="80" value="${esc(u?.nombre || '')}" placeholder="Ej. Ana Torres"></label>
      <label class="field"><span>Correo institucional *</span><input type="email" name="correo" value="${esc(u?.correo || '')}" placeholder="usuario@institucion.edu.mx"></label>
      <div class="field-grid">
        <label class="field"><span>Rol *</span><select name="rol">${Object.entries(ROL_INFO).map(([k, v]) => `<option value="${k}" ${(u?.rol || 'solicitante') === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
        <label class="field"><span>Estado</span><select name="activo"><option value="1" ${!u || u.activo ? 'selected' : ''}>Activo</option><option value="0" ${u && !u.activo ? 'selected' : ''}>Inactivo</option></select></label>
      </div>
      <label class="field"><span>Contraseña ${nuevo ? '*' : '(déjala vacía para conservar la actual)'}</span><input type="text" name="password" autocomplete="off" placeholder="Mínimo 8 caracteres, con letras y números"></label>
      <div class="alert alert-error" hidden></div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Cancelar</button><button type="submit" class="btn btn-primary">${icon('check')} ${nuevo ? 'Guardar usuario' : 'Guardar cambios'}</button></div>
    </form>`);
  $('#modalBody [name=nombre]').focus();
}

FORMULARIOS.usuario = async form => {
  const id = form.dataset.id;
  const datos = { nombre: form.nombre.value, correo: form.correo.value, rol: form.rol.value, activo: form.activo.value === '1', password: form.password.value };
  if (id) await api(`/usuarios/${id}`, { method: 'PUT', body: datos });
  else await api('/usuarios', { method: 'POST', body: datos });
  cerrarModal();
  toast(id ? 'Usuario actualizado' : 'Usuario registrado', id ? 'Los cambios se guardaron en la base de datos.' : `${datos.nombre} ya puede iniciar sesión.`);
  refrescarAdmin();
};

Object.assign(ACCIONES, {
  'u-filtro': (id, el) => { ADM.filtroRol = el.dataset.f; renderVista(); },
  'u-nuevo': () => abrirUsuario(null),
  'u-editar': id => abrirUsuario(ADM.usuarios.find(u => String(u.id) === id)),
  'u-activo': async id => {
    const u = ADM.usuarios.find(x => String(x.id) === id);
    await api(`/usuarios/${id}/activo`, { method: 'PATCH', body: { activo: !u.activo } });
    toast(u.activo ? 'Cuenta desactivada' : 'Cuenta activada', `${u.nombre} ${u.activo ? 'ya no podrá iniciar sesión' : 'puede volver a iniciar sesión'}.`);
    refrescarAdmin();
  },
  'u-eliminar': async id => {
    const u = ADM.usuarios.find(x => String(x.id) === id);
    if (!confirm(`¿Eliminar a ${u.nombre} (${u.correo})?\n\nTambién se eliminarán sus ${u.reportes} reporte(s) y sus notificaciones. Esta acción no se puede deshacer.`)) return;
    await api(`/usuarios/${id}`, { method: 'DELETE' });
    toast('Usuario eliminado', `${u.correo} se borró de la base de datos.`);
    refrescarAdmin();
  }
});

/* =========================================================
   CATÁLOGO DEL CAMPUS
   ========================================================= */
RENDER.catalogo = () => {
  const tabs = [['ubicaciones', 'Edificios y espacios'], ['categorias', 'Categorías'], ['severidades', 'Severidades y SLA']];
  const cuerpo = { ubicaciones: catUbicaciones, categorias: catCategorias, severidades: catSeveridades }[ADM.catTab]();
  return `
  <div class="toolbar">
    <div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${ADM.catTab === k ? 'is-on' : ''}" data-action="cat-tab" data-tab="${k}">${l}</button>`).join('')}</div>
    <p class="muted small">Lo que agregues aquí aparece de inmediato en el formulario de reporte.</p>
  </div>
  ${cuerpo}`;
};

function catUbicaciones() {
  const totalEsp = CATALOGO.reduce((a, e) => a + e.niveles.reduce((b, n) => b + n.espacios.length, 0), 0);
  return `
  <section class="card">
    <div class="card-head"><div><h3>Agregar edificio</h3><p class="muted small">${CATALOGO.length} edificios · ${totalEsp} espacios registrados</p></div></div>
    <form class="inline-form" data-form="edificio" novalidate>
      <label class="field f-xs"><span>Clave *</span><input type="text" name="id" maxlength="5" placeholder="E"></label>
      <label class="field"><span>Nombre *</span><input type="text" name="nombre" maxlength="80" placeholder="Edificio E · Posgrado"></label>
      <label class="field"><span>Imagen (opcional)</span><input type="text" name="imagen" placeholder="img/edificio-e.jpg"></label>
      <button class="btn btn-primary" type="submit">${icon('plus')} Agregar</button>
      <div class="alert alert-error" hidden></div>
    </form>
  </section>
  <div class="edif-grid">
    ${CATALOGO.map(ed => `
    <section class="card edif-card">
      <div class="edif-head" style="${bgImg(ed.img)}">
        <div><small>Edificio ${esc(ed.id)}</small><strong>${esc(edCorto(ed))}</strong></div>
        <button class="btn btn-sm btn-glass" data-action="cat-del-edificio" data-id="${esc(ed.id)}">${icon('trash')} Eliminar</button>
      </div>
      <div class="edif-body">
        ${ed.niveles.map(n => `
        <div class="nivel-box">
          <div class="nivel-head"><strong>${esc(n.nombre)} <code>${esc(n.id)}</code></strong>
            <button class="icon-btn icon-sm" data-action="cat-del-nivel" data-id="${n.dbId}" aria-label="Eliminar nivel">${icon('trash')}</button></div>
          <div class="esp-chips">${(n.espaciosDet || []).map(es => `
            <span class="esp-chip">${esc(es.nombre)}${es.tickets ? `<b title="Tickets en este espacio">${es.tickets}</b>` : ''}
              <button data-action="cat-del-espacio" data-id="${es.id}" data-nombre="${esc(es.nombre)}" aria-label="Eliminar ${esc(es.nombre)}">${icon('x')}</button></span>`).join('') || '<span class="muted small">Sin espacios</span>'}
          </div>
          <form class="mini-form" data-form="espacio" data-nivel="${n.dbId}" novalidate>
            <input type="text" name="nombre" maxlength="80" placeholder="Nuevo espacio (ej. Aula B-104)">
            <button class="btn btn-ghost btn-sm" type="submit">${icon('plus')} Agregar</button>
          </form>
        </div>`).join('')}
        <form class="mini-form nivel-form" data-form="nivel" data-edificio="${esc(ed.id)}" novalidate>
          <input type="text" name="clave" maxlength="6" placeholder="Clave (N3)" class="f-xs">
          <input type="text" name="nombre" maxlength="40" placeholder="Nombre del nivel (Nivel 3)">
          <button class="btn btn-ghost btn-sm" type="submit">${icon('layers')} Agregar nivel</button>
        </form>
      </div>
    </section>`).join('')}
  </div>`;
}

function catCategorias() {
  return `
  <section class="card">
    <div class="card-head"><h3>Agregar categoría</h3></div>
    <form class="inline-form" data-form="categoria" novalidate>
      <label class="field"><span>Nombre *</span><input type="text" name="nombre" maxlength="40" placeholder="Jardinería"></label>
      <label class="field"><span>Descripción</span><input type="text" name="descripcion" maxlength="80" placeholder="Áreas verdes, riego, poda"></label>
      <label class="field f-sm"><span>Ícono</span><select name="icono">${ICONOS_CAT.map(i => `<option value="${i}">${i}</option>`).join('')}</select></label>
      <button class="btn btn-primary" type="submit">${icon('plus')} Agregar</button>
      <div class="alert alert-error" hidden></div>
    </form>
  </section>
  <section class="card">
    <div class="table-wrap"><table class="table">
      <thead><tr><th>ID</th><th>Categoría</th><th>Descripción</th><th>Ícono</th><th>Tickets</th><th></th></tr></thead>
      <tbody>${Object.entries(CATEGORIAS).map(([nombre, c]) => `<tr>
        <td data-label="ID"><code>${c.id}</code></td>
        <td data-label="Categoría"><div class="user-cell"><span class="thumb thumb-sm cat-${slug(nombre)}">${icon(c.icono)}</span><strong>${esc(nombre)}</strong></div></td>
        <td data-label="Descripción">${esc(c.desc) || '<span class="muted">—</span>'}</td>
        <td data-label="Ícono"><code>${esc(c.icono)}</code></td>
        <td data-label="Tickets">${c.tickets ?? 0}</td>
        <td data-label="Acciones"><div class="row-actions">
          <button class="btn btn-ghost btn-sm" data-action="cat-editar-categoria" data-id="${c.id}">${icon('edit')} Editar</button>
          <button class="btn btn-danger btn-sm" data-action="cat-del-categoria" data-id="${c.id}" data-nombre="${esc(nombre)}" aria-label="Eliminar">${icon('trash')}</button>
        </div></td></tr>`).join('')}</tbody>
    </table></div>
  </section>`;
}

function catSeveridades() {
  return `
  <div class="sev-admin">${Object.entries(SEVERIDADES).map(([k, v]) => `
    <form class="card sev-card-adm lvl-${slug(k)}" data-form="severidad" data-nombre="${esc(k)}" novalidate>
      <div class="card-head"><h3><span class="sev-dot"></span>${esc(k)}</h3><span class="muted small">Tabla severidades</span></div>
      <label class="field"><span>Tiempo máximo de atención (horas)</span><input type="text" inputmode="numeric" name="sla_horas" value="${v.sla}"></label>
      <label class="field"><span>Descripción</span><input type="text" name="descripcion" maxlength="80" value="${esc(v.desc)}"></label>
      <div class="alert alert-error" hidden></div>
      <button class="btn btn-primary btn-sm" type="submit">${icon('check')} Guardar SLA</button>
    </form>`).join('')}
  </div>
  <p class="tiny muted">Al cambiar el SLA se recalculan al instante los indicadores de cumplimiento del dashboard y de las métricas.</p>`;
}

async function catGuardar(ruta, metodo, datos, mensaje) {
  await api(ruta, { method: metodo, body: datos });
  await sincronizar();
  toast('Catálogo actualizado', mensaje);
  refrescarAdmin();
}

Object.assign(FORMULARIOS, {
  edificio: form => catGuardar('/catalogo/edificios', 'POST', { id: form.id.value, nombre: form.nombre.value, imagen: form.imagen.value }, `Se agregó el edificio ${form.id.value.toUpperCase()}.`),
  nivel: form => catGuardar('/catalogo/niveles', 'POST', { edificio_id: form.dataset.edificio, clave: form.clave.value, nombre: form.nombre.value }, `Se agregó el nivel ${form.nombre.value}.`),
  espacio: form => catGuardar('/catalogo/espacios', 'POST', { nivel_id: form.dataset.nivel, nombre: form.nombre.value }, `Se agregó el espacio ${form.nombre.value}.`),
  categoria: async form => {
    const id = form.dataset.id;
    const datos = { nombre: form.nombre.value, descripcion: form.descripcion.value, icono: form.icono.value };
    await catGuardar(id ? `/catalogo/categorias/${id}` : '/catalogo/categorias', id ? 'PUT' : 'POST', datos, id ? 'La categoría se actualizó.' : `Se agregó la categoría ${datos.nombre}.`);
    if (id) cerrarModal();
  },
  severidad: form => catGuardar(`/catalogo/severidades/${encodeURIComponent(form.dataset.nombre)}`, 'PUT', { sla_horas: form.sla_horas.value, descripcion: form.descripcion.value }, `SLA de severidad ${form.dataset.nombre}: ${form.sla_horas.value} h.`)
});

async function catEliminar(ruta, pregunta, mensaje) {
  if (!confirm(pregunta)) return;
  await api(ruta, { method: 'DELETE' });
  await sincronizar();
  toast('Registro eliminado', mensaje);
  refrescarAdmin();
}

Object.assign(ACCIONES, {
  'cat-tab': (id, el) => { ADM.catTab = el.dataset.tab; renderVista(); },
  'cat-del-edificio': id => catEliminar(`/catalogo/edificios/${encodeURIComponent(id)}`, `¿Eliminar el edificio ${id} con todos sus niveles y espacios?\n\nSi algún espacio tiene tickets, la base de datos lo impedirá (llave foránea).`, `Se eliminó el edificio ${id}.`),
  'cat-del-nivel': id => catEliminar(`/catalogo/niveles/${id}`, '¿Eliminar este nivel y todos sus espacios?', 'Se eliminó el nivel.'),
  'cat-del-espacio': (id, el) => catEliminar(`/catalogo/espacios/${id}`, `¿Eliminar el espacio "${el.dataset.nombre}"?`, `Se eliminó ${el.dataset.nombre}.`),
  'cat-del-categoria': (id, el) => catEliminar(`/catalogo/categorias/${id}`, `¿Eliminar la categoría "${el.dataset.nombre}"?`, `Se eliminó la categoría ${el.dataset.nombre}.`),
  'cat-editar-categoria': id => {
    const [nombre, c] = Object.entries(CATEGORIAS).find(([, x]) => String(x.id) === id);
    state.modal = { tipo: 'categoria' };
    abrirModal(`
      <form class="modal-pad" data-form="categoria" data-id="${id}" novalidate>
        <div class="modal-head"><span class="stat-ic">${icon('edit')}</span><div><h3>Editar categoría</h3><p class="muted small">Registro #${id} de la tabla categorias.</p></div></div>
        <label class="field"><span>Nombre *</span><input type="text" name="nombre" maxlength="40" value="${esc(nombre)}"></label>
        <label class="field"><span>Descripción</span><input type="text" name="descripcion" maxlength="80" value="${esc(c.desc)}"></label>
        <label class="field"><span>Ícono</span><select name="icono">${ICONOS_CAT.map(i => `<option value="${i}" ${c.icono === i ? 'selected' : ''}>${i}</option>`).join('')}</select></label>
        <div class="alert alert-error" hidden></div>
        <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Cancelar</button><button type="submit" class="btn btn-primary">${icon('check')} Guardar</button></div>
      </form>`);
  }
});

/* =========================================================
   BASE DE DATOS (explorador)
   ========================================================= */
RENDER.basedatos = () => {
  const total = ADM.tablas ? ADM.tablas.reduce((a, t) => a + (t.tipo === 'tabla' ? t.registros : 0), 0) : '…';
  const nTablas = ADM.tablas ? ADM.tablas.filter(t => t.tipo === 'tabla').length : '…';
  return `
  <section class="hero-banner hero-sm db-hero" style="--bg:url('img/banner-admin.jpg')">
    <div class="hero-banner-content">
      <span class="pill pill-glass">${icon('database')} SQLite · database/campuscare.db</span>
      <h2>Base de datos de CampusCare</h2>
      <p><b>${nTablas}</b> tablas · <b>${total}</b> registros. Todo lo que se captura en los formularios queda guardado aquí.</p>
      <div class="btn-row">
        <button class="btn btn-light" data-action="db-actualizar">${icon('refresh')} Actualizar</button>
        <button class="btn btn-glass" data-action="db-respaldo">${icon('download')} Descargar respaldo .db</button>
        <button class="btn btn-glass" data-action="db-reset">${icon('alert')} Restablecer datos de demostración</button>
      </div>
    </div>
  </section>

  <div class="btn-row mobile-links">
    <button class="btn btn-ghost btn-sm" data-action="nav" data-view="usuarios">${icon('users')} Usuarios</button>
    <button class="btn btn-ghost btn-sm" data-action="nav" data-view="catalogo">${icon('building')} Catálogo</button>
  </div>

  <div class="db-layout">
    <aside class="card db-aside" id="dbTablas">${ADM.tablas ? listaTablas() : cargando('Cargando tablas')}</aside>
    <section class="card db-main" id="dbDatos">${ADM.datos ? vistaTabla() : cargando('Cargando registros')}</section>
  </div>

  <section class="card sql-card">
    <div class="card-head"><div><h3>${icon('terminal')} Consola SQL</h3><p class="muted small">Solo consultas de lectura (SELECT). Presiona Ctrl + Enter para ejecutar.</p></div></div>
    <div class="sql-examples">${[
      ['Tickets con SLA', 'SELECT folio, estado, severidad, edificio, espacio, solicitante, tecnico, sla\nFROM vista_reporte_tickets\nORDER BY creado_en DESC'],
      ['Tickets por estado', 'SELECT estado, COUNT(*) AS total\nFROM tickets\nGROUP BY estado\nORDER BY total DESC'],
      ['Reportes por usuario', 'SELECT u.nombre, u.rol, COUNT(t.id) AS reportes\nFROM usuarios u\nLEFT JOIN tickets t ON t.solicitante_id = u.id\nGROUP BY u.id\nORDER BY reportes DESC'],
      ['Bitácora de accesos', 'SELECT correo, evento, exito, detalle, fecha\nFROM accesos\nORDER BY fecha DESC'],
      ['Historial de un ticket', "SELECT h.estado_anterior, h.estado_nuevo, h.usuario_nombre, h.nota, h.fecha\nFROM historial_estados h\nJOIN tickets t ON t.id = h.ticket_id\nWHERE t.folio = 'CC-1001'\nORDER BY h.fecha"],
      ['Estructura de la base', "SELECT type, name, tbl_name\nFROM sqlite_master\nWHERE name NOT LIKE 'sqlite_%'\nORDER BY type, name"]
    ].map(([l, q]) => `<button class="fchip" data-action="db-ejemplo" data-sql="${esc(q)}">${l}</button>`).join('')}</div>
    <textarea class="sql-input" id="sqlInput" spellcheck="false" rows="5">${esc(ADM.consulta.sql)}</textarea>
    <div class="btn-row"><button class="btn btn-primary" data-action="db-ejecutar">${icon('play')} Ejecutar consulta</button></div>
    <div id="sqlResultado">${resultadoConsulta()}</div>
  </section>`;
};

function listaTablas() {
  return `<h3 class="db-aside-title">Tablas</h3>
  <div class="db-table-list">${ADM.tablas.map(t => `
    <button class="db-table-btn ${ADM.tabla === t.nombre ? 'is-on' : ''}" data-action="db-tabla" data-tabla="${esc(t.nombre)}" title="${esc(t.descripcion)}">
      ${icon(t.tipo === 'vista' ? 'eye' : 'table')}<span>${esc(t.nombre)}</span><b>${t.registros}</b>
    </button>`).join('')}</div>`;
}

function celda(valor, col) {
  if (valor === null || valor === undefined) return '<span class="null">NULL</span>';
  const txt = String(valor);
  if (/^(foto|imagen|avatar)$/.test(col) && /\.(jpe?g|png|webp)$/i.test(txt)) {
    return `<span class="cell-img"><img src="${esc(urlArchivo(txt))}" alt="" loading="lazy" onerror="this.remove()"><span>${esc(txt.split('/').pop())}</span></span>`;
  }
  if (col === 'password_hash') return `<code class="hash" title="${esc(txt)}">${esc(txt.slice(0, 18))}…</code>`;
  if (col === 'estado') return estadoChip(txt);
  if (col === 'rol') return rolChip(txt);
  if (txt.length > 60) return `<span title="${esc(txt)}">${esc(txt.slice(0, 60))}…</span>`;
  return esc(txt);
}

function vistaTabla() {
  const d = ADM.datos;
  const esTabla = d.tipo === 'tabla';
  const paginas = Math.max(1, Math.ceil(d.total / d.porPagina));
  const desde = d.total ? (d.pagina - 1) * d.porPagina + 1 : 0;
  const hasta = Math.min(d.total, d.pagina * d.porPagina);
  const fks = d.columnas.filter(c => c.fk);
  return `
  <div class="card-head">
    <div><h3>${icon(esTabla ? 'table' : 'eye')} ${esc(d.nombre)} <span class="muted small">· ${d.total} registro${d.total === 1 ? '' : 's'}</span></h3>
      <p class="muted small">${esc(d.descripcion)}${esTabla ? '' : ' (solo lectura)'}</p></div>
    <div class="btn-row">
      <button class="btn btn-ghost btn-sm" data-action="db-ver-sql">${icon('key')} ${ADM.verSql ? 'Ocultar' : 'Ver'} estructura</button>
      ${esTabla ? `<button class="btn btn-primary btn-sm" data-action="db-nuevo">${icon('plus')} Nuevo registro</button>` : ''}
    </div>
  </div>
  ${ADM.verSql ? `
    <div class="schema-box">
      <div class="schema-cols">${d.columnas.map(c => `<span class="schema-col ${c.pk ? 'pk' : ''}">${c.pk ? icon('key') : ''}<b>${esc(c.nombre)}</b> <small>${esc(c.tipo)}${c.requerido ? ' · NOT NULL' : ''}${c.fk ? ` · → ${esc(c.fk.tabla)}.${esc(c.fk.columna)} (${esc(c.fk.alBorrar)})` : ''}</small></span>`).join('')}</div>
      <pre class="sql-code">${esc(d.sql || '')}</pre>
    </div>` : ''}
  <div class="toolbar db-toolbar">
    <div class="input-icon search-sm"><span>${icon('search')}</span><input type="search" data-adm-buscar="tabla" value="${esc(ADM.buscar)}" placeholder="Buscar en ${esc(d.nombre)}"></div>
    ${fks.length ? `<span class="muted small">${icon('link')} Relacionada con: ${[...new Set(fks.map(c => c.fk.tabla))].map(esc).join(', ')}</span>` : ''}
  </div>
  ${d.filas.length ? `
  <div class="grid-wrap"><table class="dtable">
    <thead><tr>${d.columnas.map(c => `<th>${c.pk ? icon('key') : ''}${esc(c.nombre)}</th>`).join('')}${esTabla ? '<th class="sticky-col">Acciones</th>' : ''}</tr></thead>
    <tbody>${d.filas.map(f => `<tr>${d.columnas.map(c => `<td>${celda(f[c.nombre], c.nombre)}</td>`).join('')}
      ${esTabla ? `<td class="sticky-col"><div class="row-actions">
        <button class="btn btn-ghost btn-sm" data-action="db-editar" data-id="${esc(f[d.pk])}" aria-label="Editar">${icon('edit')}</button>
        <button class="btn btn-danger btn-sm" data-action="db-eliminar" data-id="${esc(f[d.pk])}" aria-label="Eliminar">${icon('trash')}</button>
      </div></td>` : ''}</tr>`).join('')}</tbody>
  </table></div>
  <div class="pager">
    <span class="muted small">Mostrando ${desde}–${hasta} de ${d.total}</span>
    <div class="btn-row">
      <button class="btn btn-ghost btn-sm" data-action="db-pagina" data-p="${d.pagina - 1}" ${d.pagina <= 1 ? 'disabled' : ''}>Anterior</button>
      <span class="small">Página ${d.pagina} de ${paginas}</span>
      <button class="btn btn-ghost btn-sm" data-action="db-pagina" data-p="${d.pagina + 1}" ${d.pagina >= paginas ? 'disabled' : ''}>Siguiente</button>
    </div>
  </div>` : vacio(ADM.buscar ? 'Sin coincidencias' : 'Tabla vacía', ADM.buscar ? 'Prueba con otro texto.' : 'Agrega un registro con el botón “Nuevo registro”.', 'table')}`;
}

function resultadoConsulta() {
  const c = ADM.consulta;
  if (c.error) return `<div class="alert alert-error">${esc(c.error)}</div>`;
  if (!c.resultado) return '';
  const r = c.resultado;
  if (!r.filas.length) return `<p class="muted small">La consulta no devolvió registros (${r.ms} ms).</p>`;
  return `<p class="muted small">${r.total} fila${r.total === 1 ? '' : 's'} en ${r.ms} ms${r.truncado ? ' · se muestran las primeras 500' : ''}</p>
  <div class="grid-wrap"><table class="dtable">
    <thead><tr>${r.columnas.map(k => `<th>${esc(k)}</th>`).join('')}</tr></thead>
    <tbody>${r.filas.map(f => `<tr>${r.columnas.map(k => `<td>${celda(f[k], k)}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

async function cargarTabla() {
  const q = new URLSearchParams({ pagina: ADM.pagina, buscar: ADM.buscar });
  ADM.datos = await api(`/admin/tablas/${encodeURIComponent(ADM.tabla)}?${q}`);
  if (ADM.datos.pagina > 1 && !ADM.datos.filas.length) {
    ADM.pagina = 1;
    return cargarTabla();
  }
}

function pintarBD() {
  if (state.vista !== 'basedatos') return;
  const a = $('#dbTablas');
  const b = $('#dbDatos');
  if (a && ADM.tablas) a.innerHTML = listaTablas();
  if (b && ADM.datos) b.innerHTML = vistaTabla();
}

POST_RENDER.basedatos = async () => {
  try {
    const [tablas] = await Promise.all([api('/admin/tablas'), cargarTabla()]);
    const primeraVez = !ADM.tablas;
    ADM.tablas = tablas;
    if (primeraVez) renderVista(); else pintarBD();
  } catch (err) {
    const b = $('#dbDatos');
    if (b) b.innerHTML = vacio('No se pudo leer la base de datos', esc(err.message), 'alert');
  }
};

/* Formulario genérico para agregar o editar un registro de cualquier tabla */
function opcionesEnum(sql, col) {
  const re = new RegExp(`CHECK\\s*\\(\\s*${col}\\s+IN\\s*\\(([^)]*)\\)`, 'i');
  const m = re.exec(sql || '');
  return m ? [...m[1].matchAll(/'([^']*)'|(\d+)/g)].map(x => x[1] ?? x[2]) : null;
}

async function abrirRegistro(id) {
  const d = ADM.datos;
  const nuevo = id == null;
  const fila = nuevo ? {} : d.filas.find(f => String(f[d.pk]) === String(id));
  let opciones = {};
  try { opciones = await api(`/admin/tablas/${encodeURIComponent(d.nombre)}/opciones`); } catch { /* sin opciones */ }

  const campos = d.columnas.map(c => {
    const v = fila?.[c.nombre];
    const nombre = esc(c.nombre);
    const etiqueta = `${esc(c.nombre)} <small class="muted">${esc(c.tipo)}${c.requerido ? ' · obligatorio' : ''}${c.fk ? ` · → ${esc(c.fk.tabla)}` : ''}</small>`;
    if (c.autoincremento && nuevo) return `<div class="field auto-field"><span>${etiqueta}</span><em>Se genera automáticamente</em></div>`;
    if (c.pk && !nuevo) return `<div class="field auto-field"><span>${etiqueta}</span><code>${esc(v)}</code></div>`;
    const enumerado = opcionesEnum(d.sql, c.nombre);
    if (c.fk && opciones[c.nombre]) {
      return `<label class="field"><span>${etiqueta}</span><select name="${nombre}"><option value="">${c.requerido ? 'Selecciona…' : '(NULL)'}</option>
        ${opciones[c.nombre].map(o => `<option value="${esc(o.valor)}" ${String(v) === String(o.valor) ? 'selected' : ''}>${esc(o.etiqueta)}</option>`).join('')}</select></label>`;
    }
    if (enumerado) {
      return `<label class="field"><span>${etiqueta}</span><select name="${nombre}">${c.requerido || c.defecto != null ? '' : '<option value="">(NULL)</option>'}
        ${enumerado.map(o => `<option value="${esc(o)}" ${String(v ?? c.defecto?.replace(/'/g, '')) === o ? 'selected' : ''}>${esc(o === '1' ? '1 (sí)' : o === '0' ? '0 (no)' : o)}</option>`).join('')}</select></label>`;
    }
    if (/descripcion|notas|mensaje|nota|detalle|materiales/.test(c.nombre)) {
      return `<label class="field"><span>${etiqueta}</span><textarea name="${nombre}" rows="2">${esc(v ?? '')}</textarea></label>`;
    }
    const ph = c.nombre === 'password_hash' ? 'Escribe una contraseña: se cifrará con bcrypt'
      : /(_en|fecha)$/.test(c.nombre) ? 'AAAA-MM-DD HH:MM:SS (vacío = ahora)'
      : c.defecto != null ? `Por defecto: ${c.defecto}` : '';
    return `<label class="field"><span>${etiqueta}</span><input type="text" name="${nombre}" value="${esc(v ?? '')}" placeholder="${esc(ph)}"></label>`;
  }).join('');

  state.modal = { tipo: 'registro' };
  abrirModal(`
    <form class="modal-pad" data-form="registro" data-tabla="${esc(d.nombre)}" ${nuevo ? '' : `data-id="${esc(id)}"`} novalidate>
      <div class="modal-head"><span class="stat-ic">${icon(nuevo ? 'plus' : 'edit')}</span><div><h3>${nuevo ? 'Nuevo registro' : `Editar registro ${esc(id)}`}</h3><p class="muted small">Tabla <code>${esc(d.nombre)}</code>. Las reglas de la base (llaves foráneas, CHECK, UNIQUE) se validan al guardar.</p></div></div>
      <div class="db-form-grid">${campos}</div>
      <div class="alert alert-error" hidden></div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Cancelar</button><button type="submit" class="btn btn-primary">${icon('check')} ${nuevo ? 'Insertar' : 'Guardar cambios'}</button></div>
    </form>`, true);
}

FORMULARIOS.registro = async form => {
  const tabla = form.dataset.tabla;
  const id = form.dataset.id;
  const valores = {};
  $$('[name]', form).forEach(el => {
    if (!id && el.value === '') return;
    valores[el.name] = el.value;
  });
  if (id) await api(`/admin/tablas/${encodeURIComponent(tabla)}/${encodeURIComponent(id)}`, { method: 'PUT', body: { valores } });
  else await api(`/admin/tablas/${encodeURIComponent(tabla)}`, { method: 'POST', body: { valores } });
  cerrarModal();
  toast(id ? 'Registro actualizado' : 'Registro insertado', `Tabla ${tabla}.`);
  refrescarAdmin();
  sincronizar().catch(() => {});
};

async function descargarRespaldo() {
  const res = await fetch(`${API_ORIGEN}/api/admin/respaldo`, { headers: { Authorization: `Bearer ${Auth.token()}` } });
  if (!res.ok) throw new Error('No se pudo descargar el respaldo.');
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `campuscare-respaldo-${new Date().toISOString().slice(0, 10)}.db`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Respaldo descargado', 'Ábrelo con DB Browser for SQLite para revisarlo.');
}

async function ejecutarConsulta() {
  const sql = $('#sqlInput').value;
  ADM.consulta.sql = sql;
  try {
    ADM.consulta.resultado = await api('/admin/consulta', { method: 'POST', body: { sql } });
    ADM.consulta.error = '';
  } catch (err) {
    ADM.consulta.resultado = null;
    ADM.consulta.error = err.message;
  }
  const caja = $('#sqlResultado');
  if (caja) caja.innerHTML = resultadoConsulta();
}

Object.assign(ACCIONES, {
  'db-tabla': async (id, el) => {
    ADM.tabla = el.dataset.tabla;
    ADM.pagina = 1;
    ADM.buscar = '';
    ADM.verSql = false;
    $$('.db-table-btn').forEach(b => b.classList.toggle('is-on', b === el));
    await cargarTabla();
    pintarBD();
    if (matchMedia('(max-width: 991px)').matches) $('#dbDatos')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  'db-pagina': async (id, el) => { ADM.pagina = Number(el.dataset.p); await cargarTabla(); pintarBD(); },
  'db-ver-sql': () => { ADM.verSql = !ADM.verSql; pintarBD(); },
  'db-actualizar': () => { refrescarAdmin(); toast('Datos actualizados', 'Se volvió a leer la base de datos.', 'info'); },
  'db-nuevo': () => abrirRegistro(null),
  'db-editar': id => abrirRegistro(id),
  'db-eliminar': async id => {
    const t = ADM.datos.nombre;
    if (!confirm(`¿Eliminar el registro ${id} de la tabla "${t}"?\n\nLos registros relacionados con ON DELETE CASCADE también se eliminarán. Si otra tabla depende de él con RESTRICT, la base de datos lo impedirá.`)) return;
    const r = await api(`/admin/tablas/${encodeURIComponent(t)}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    toast('Registro eliminado', `Se eliminó ${r.eliminados} registro de ${t}.`);
    refrescarAdmin();
    sincronizar().catch(() => {});
  },
  'db-ejemplo': (id, el) => { $('#sqlInput').value = el.dataset.sql; ejecutarConsulta(); },
  'db-ejecutar': () => ejecutarConsulta(),
  'db-respaldo': () => descargarRespaldo(),
  'db-reset': async () => {
    if (!confirm('Se borrarán TODOS los registros (usuarios creados, reportes, fotos, notificaciones) y se cargarán los datos de demostración. ¿Continuar?')) return;
    await api('/admin/reset', { method: 'POST' });
    await DB.sync();
    iniciarEntregas(Auth.sesion());
    ADM.usuarios = null;
    ADM.tablas = null;
    toast('Base de datos restablecida', 'Se cargaron los datos de demostración.');
    renderVista();
  }
});

/* Búsquedas en vivo y atajo Ctrl + Enter en la consola */
let temporizadorAdm;
document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset?.admBuscar === 'usuarios') {
    ADM.buscarUsuario = el.value;
    const caja = $('#admUsuarios');
    if (caja && ADM.usuarios) caja.innerHTML = tablaUsuarios();
  }
  if (el.dataset?.admBuscar === 'tabla') {
    ADM.buscar = el.value;
    ADM.pagina = 1;
    clearTimeout(temporizadorAdm);
    temporizadorAdm = setTimeout(async () => {
      await cargarTabla();
      const b = $('#dbDatos');
      if (!b) return;
      const pos = el.selectionStart;
      b.innerHTML = vistaTabla();
      const nuevo = $('[data-adm-buscar="tabla"]');
      nuevo?.focus();
      nuevo?.setSelectionRange(pos, pos);
    }, 250);
  }
  if (el.id === 'sqlInput') ADM.consulta.sql = el.value;
});

document.addEventListener('keydown', e => {
  if (e.target.id === 'sqlInput' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    ejecutarConsulta();
  }
});
