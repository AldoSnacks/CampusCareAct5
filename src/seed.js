/* =========================================================
   Datos iniciales (catálogo, usuarios de demostración y
   tickets de ejemplo para que el dashboard tenga información)
   ========================================================= */
'use strict';
const bcrypt = require('bcryptjs');
const { conexion, transaccion, fecha } = require('./db');

const PASSWORD_DEMO = 'Campus2026';
const HORA = 3600000;

const USUARIOS = [
  ['alumno@institucion.edu.mx',   'María Fernanda López', 'solicitante',   'img/avatar-alumno.jpg'],
  ['docente@institucion.edu.mx',  'Dr. Jorge Ramírez',    'solicitante',   'img/avatar-docente.jpg'],
  ['tecnico@institucion.edu.mx',  'Ing. Carlos Méndez',   'mantenimiento', 'img/avatar-tecnico.jpg'],
  ['tecnico2@institucion.edu.mx', 'Luis Hernández',       'mantenimiento', null],
  ['tecnico3@institucion.edu.mx', 'Ana Torres',           'mantenimiento', null],
  ['admin@institucion.edu.mx',    'Lic. Patricia Gómez',  'admin',         'img/avatar-admin.jpg']
];

const EDIFICIOS = [
  ['A', 'Edificio A · Rectoría', 'img/edificio-a.jpg', [
    ['PB', 'Planta baja', ['Recepción', 'Servicios Escolares', 'Sanitarios PB', 'Pasillo principal']],
    ['N1', 'Nivel 1',     ['Sala de juntas', 'Oficinas de Dirección', 'Sanitarios N1']],
    ['N2', 'Nivel 2',     ['Auditorio', 'Sala de consejo']]
  ]],
  ['B', 'Edificio B · Ingeniería', 'img/edificio-b.jpg', [
    ['PB', 'Planta baja', ['Aula B-101', 'Aula B-102', 'Aula B-103', 'Sanitarios PB']],
    ['N1', 'Nivel 1',     ['Aula B-201', 'Aula B-202', 'Lab. de Electrónica']],
    ['N2', 'Nivel 2',     ['Aula B-301', 'Lab. de Redes', 'Sala de maestros']]
  ]],
  ['C', 'Edificio C · Biblioteca', 'img/edificio-c.jpg', [
    ['PB', 'Planta baja', ['Acervo general', 'Área de préstamo', 'Sanitarios PB']],
    ['N1', 'Nivel 1',     ['Cubículos de estudio', 'Sala de cómputo', 'Hemeroteca']]
  ]],
  ['D', 'Edificio D · Laboratorios', 'img/edificio-d.jpg', [
    ['PB', 'Planta baja', ['Lab. de Química', 'Lab. de Física', 'Almacén']],
    ['N1', 'Nivel 1',     ['Lab. de Cómputo 1', 'Lab. de Cómputo 2', 'Site de TI']],
    ['N2', 'Nivel 2',     ['Lab. de Biología', 'Cafetería']]
  ]]
];

const CATEGORIAS = [
  ['Eléctrica',   'Luminarias, contactos, tableros',  'zap',      'img/cat-electrica.jpg'],
  ['Mobiliario',  'Sillas, mesas, pizarrones',        'chair',    'img/cat-mobiliario.jpg'],
  ['Red/TI',      'Internet, proyectores, equipos',   'wifi',     'img/cat-red.jpg'],
  ['Plomería',    'Fugas, sanitarios, lavabos',       'drop',     'img/cat-plomeria.jpg'],
  ['Estructural', 'Muros, techos, pisos, puertas',    'building', 'img/cat-estructural.jpg']
];

const SEVERIDADES = [
  ['Baja',    72, 'No impide usar el espacio.', 2],
  ['Media',   24, 'Afecta parcialmente las actividades.', 1],
  ['Crítica',  4, 'Riesgo para personas o suspende clases.', 0]
];

const SOLUCION = {
  'Eléctrica':   ['Se sustituyó el componente dañado, se revisó el circuito y se midió la tensión (127 V).', 'Contacto dúplex, cinta aislante, cable THW cal. 12'],
  'Red/TI':      ['Se reconfiguró el equipo y se probó la conectividad en todos los puntos.', 'Cable UTP Cat 6, conectores RJ45'],
  'Plomería':    ['Se cambió el empaque y se verificó que no existieran fugas.', 'Empaques, cinta teflón, llave de paso 1/2"'],
  'Mobiliario':  ['Se reparó la estructura y se ajustó la tornillería.', 'Tornillería, respaldo de repuesto'],
  'Estructural': ['Se reemplazó la pieza dañada y se selló el perímetro.', 'Cerradura de seguridad, sellador acrílico']
};

// [edificio, nivel, espacio, activo, categoría, severidad, descripción, estado final, horas atrás, horas de resolución, técnico]
const TICKETS = [
  ['B', 'PB', 'Aula B-101', 'Proyector', 'Red/TI', 'Media', 'El proyector no enciende y la lámpara parpadea.', 'Cerrado', 320, 9, 0],
  ['B', 'N1', 'Lab. de Electrónica', 'Contactos / apagadores', 'Eléctrica', 'Crítica', 'Contacto con chispa y olor a quemado en la mesa 4.', 'Cerrado', 290, 3, 1],
  ['C', 'PB', 'Sanitarios PB', 'Lavabo / llave', 'Plomería', 'Media', 'Fuga constante en la llave del lavabo central.', 'Cerrado', 260, 20, 2],
  ['D', 'N1', 'Lab. de Cómputo 1', 'Nodo de red', 'Red/TI', 'Media', 'Sin conexión a internet en la fila 3 de equipos.', 'Cerrado', 240, 30, 0],
  ['A', 'PB', 'Pasillo principal', 'Luminarias', 'Eléctrica', 'Baja', 'Dos lámparas fundidas cerca de la entrada.', 'Cerrado', 220, 40, 1],
  ['B', 'N2', 'Aula B-301', 'Pupitres / sillas', 'Mobiliario', 'Baja', 'Cinco pupitres con el respaldo roto.', 'Cerrado', 200, 60, 2],
  ['D', 'PB', 'Lab. de Química', 'Lavabo / llave', 'Plomería', 'Crítica', 'Fuga de agua bajo la tarja de lavado de material.', 'Cerrado', 180, 6, 1],
  ['B', 'PB', 'Aula B-102', 'Aire acondicionado', 'Eléctrica', 'Media', 'El aire acondicionado gotea y hace ruido.', 'Resuelto', 150, 18, 0],
  ['C', 'N1', 'Sala de cómputo', 'Equipo de cómputo', 'Red/TI', 'Baja', 'Tres equipos no inician sesión con la cuenta institucional.', 'Resuelto', 120, 26, 0],
  ['A', 'N2', 'Auditorio', 'Muros / techo', 'Estructural', 'Media', 'Mancha de humedad y desprendimiento de pintura en el plafón.', 'Rechazado', 110, null, null],
  ['B', 'N1', 'Aula B-201', 'Ventanas', 'Estructural', 'Media', 'Ventana con el vidrio estrellado.', 'En Proceso', 30, null, 2],
  ['D', 'N1', 'Site de TI', 'Aire acondicionado', 'Eléctrica', 'Crítica', 'El clima del site se apagó; la temperatura va en aumento.', 'En Proceso', 6, null, 1],
  ['B', 'PB', 'Sanitarios PB', 'WC / mingitorio', 'Plomería', 'Media', 'WC tapado en el sanitario de hombres.', 'Asignado', 10, null, 0],
  ['C', 'PB', 'Acervo general', 'Luminarias', 'Eléctrica', 'Baja', 'Luz intermitente en el pasillo 5 del acervo.', 'Asignado', 40, null, 1],
  ['D', 'N2', 'Cafetería', 'Mobiliario', 'Mobiliario', 'Baja', 'Mesa coja en el área de comensales.', 'Abierto', 20, null, null],
  ['B', 'N2', 'Lab. de Redes', 'Access point Wi-Fi', 'Red/TI', 'Crítica', 'Wi-Fi caído durante un examen práctico.', 'Abierto', 2, null, null],
  ['A', 'N1', 'Sala de juntas', 'Pantalla / TV', 'Red/TI', 'Media', 'La pantalla no detecta la entrada HDMI.', 'Abierto', 30, null, null],
  ['B', 'PB', 'Aula B-103', 'Puerta / cerradura', 'Estructural', 'Media', 'La cerradura no cierra; el aula queda abierta.', 'Cerrado', 96, 12, 2],
  ['D', 'PB', 'Lab. de Física', 'Contactos / apagadores', 'Eléctrica', 'Media', 'Apagador suelto con cables expuestos.', 'Cerrado', 72, 8, 1],
  ['B', 'N1', 'Aula B-202', 'Proyector', 'Red/TI', 'Baja', 'El control remoto del proyector no funciona.', 'Cerrado', 50, 20, 0]
];

function mensajeEstado(estado, tecnicoNombre, motivo) {
  return ({
    'Asignado':   `Tu reporte fue asignado a ${tecnicoNombre}.`,
    'En Proceso': 'El personal de mantenimiento inició los trabajos.',
    'Resuelto':   'Tu reporte fue resuelto. Revisa la evidencia del trabajo.',
    'Rechazado':  `Tu reporte fue rechazado: ${motivo || ''}`,
    'Cerrado':    'El ticket fue validado y cerrado.'
  })[estado];
}

function sembrar() {
  const ahora = Date.now();
  const hash = bcrypt.hashSync(PASSWORD_DEMO, 10);

  transaccion(db => {
    // Usuarios
    const insUsuario = db.prepare('INSERT INTO usuarios (correo, nombre, rol, password_hash, avatar, creado_en) VALUES (?, ?, ?, ?, ?, ?)');
    const usuarios = {};
    for (const [correo, nombre, rol, avatar] of USUARIOS) {
      const r = insUsuario.run(correo, nombre, rol, hash, avatar, fecha(ahora - 400 * HORA));
      usuarios[correo] = { id: Number(r.lastInsertRowid), nombre, rol };
    }

    // Catálogo de ubicaciones
    const insEdif = db.prepare('INSERT INTO edificios (id, nombre, imagen) VALUES (?, ?, ?)');
    const insNivel = db.prepare('INSERT INTO niveles (edificio_id, clave, nombre) VALUES (?, ?, ?)');
    const insEspacio = db.prepare('INSERT INTO espacios (nivel_id, nombre) VALUES (?, ?)');
    const espacios = {};
    for (const [id, nombre, imagen, niveles] of EDIFICIOS) {
      insEdif.run(id, nombre, imagen);
      for (const [clave, nomNivel, lista] of niveles) {
        const nivelId = Number(insNivel.run(id, clave, nomNivel).lastInsertRowid);
        for (const esp of lista) espacios[`${id}|${clave}|${esp}`] = Number(insEspacio.run(nivelId, esp).lastInsertRowid);
      }
    }

    // Categorías y severidades
    const categorias = {};
    const insCat = db.prepare('INSERT INTO categorias (nombre, descripcion, icono, imagen) VALUES (?, ?, ?, ?)');
    for (const [nombre, desc, icono, img] of CATEGORIAS) categorias[nombre] = Number(insCat.run(nombre, desc, icono, img).lastInsertRowid);
    const insSev = db.prepare('INSERT INTO severidades (nombre, sla_horas, descripcion, orden) VALUES (?, ?, ?, ?)');
    for (const s of SEVERIDADES) insSev.run(...s);

    // Tickets de ejemplo con su historial completo
    const solicitantes = USUARIOS.filter(u => u[2] === 'solicitante').map(u => usuarios[u[0]]);
    const tecnicos = USUARIOS.filter(u => u[2] === 'mantenimiento').map(u => usuarios[u[0]]);
    const admin = usuarios['admin@institucion.edu.mx'];

    const insTicket = db.prepare(`INSERT INTO tickets
      (solicitante_id, espacio_id, activo, categoria_id, severidad, descripcion, estado, creado_en, actualizado_en)
      VALUES (?, ?, ?, ?, ?, ?, 'Abierto', ?, ?)`);
    const insHist = db.prepare('INSERT INTO historial_estados (ticket_id, estado_anterior, estado_nuevo, usuario_id, usuario_nombre, nota, fecha) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const insNotif = db.prepare('INSERT INTO notificaciones (usuario_id, ticket_id, titulo, mensaje, leida, creada_en) VALUES (?, ?, ?, ?, ?, ?)');
    const insRes = db.prepare('INSERT INTO resoluciones (ticket_id, tecnico_id, foto, notas, materiales, resuelto_en) VALUES (?, ?, NULL, ?, ?, ?)');
    const updTicket = db.prepare('UPDATE tickets SET estado = ?, tecnico_id = COALESCE(?, tecnico_id), motivo_rechazo = COALESCE(?, motivo_rechazo), actualizado_en = ? WHERE id = ?');
    const leerFolio = db.prepare('SELECT folio FROM tickets WHERE id = ?');

    TICKETS.forEach((p, i) => {
      const [ed, niv, esp, act, cat, sev, desc, final, hAtras, hRes, tec] = p;
      const creado = ahora - hAtras * HORA;
      const sol = solicitantes[i % solicitantes.length];
      const tecnico = tec != null ? tecnicos[tec] : null;
      const id = Number(insTicket.run(sol.id, espacios[`${ed}|${niv}|${esp}`], act, categorias[cat], sev, desc, fecha(creado), fecha(creado)).lastInsertRowid);
      const folio = leerFolio.get(id).folio;
      insHist.run(id, null, 'Abierto', sol.id, sol.nombre, 'Incidencia registrada por el solicitante', fecha(creado));

      let estado = 'Abierto';
      const paso = (nuevo, at, quien, nota, extra = {}) => {
        insHist.run(id, estado, nuevo, quien.id, quien.nombre, nota, fecha(at));
        updTicket.run(nuevo, extra.tecnico ?? null, extra.motivo ?? null, fecha(at), id);
        insNotif.run(sol.id, id, `${folio} · ${nuevo}`, mensajeEstado(nuevo, tecnico?.nombre, extra.motivo), ahora - at > 12 * HORA ? 1 : 0, fecha(at));
        estado = nuevo;
      };

      if (final === 'Rechazado') {
        const motivo = 'Ya existe una orden de obra programada para el plafón del auditorio.';
        paso('Rechazado', creado + 1.5 * HORA, admin, motivo, { motivo });
      } else if (final !== 'Abierto') {
        const lapso = hRes ?? Math.max(hAtras - 0.2, 0.5);
        paso('Asignado', creado + Math.min(0.5, lapso * 0.15) * HORA, admin, `Asignado a ${tecnico.nombre}`, { tecnico: tecnico.id });
        if (['En Proceso', 'Resuelto', 'Cerrado'].includes(final)) paso('En Proceso', creado + lapso * 0.35 * HORA, tecnico, 'Inicio de labores en sitio');
        if (['Resuelto', 'Cerrado'].includes(final)) {
          const at = creado + hRes * HORA;
          insRes.run(id, tecnico.id, SOLUCION[cat][0], SOLUCION[cat][1], fecha(at));
          paso('Resuelto', at, tecnico, 'Trabajo concluido con evidencia');
        }
        if (final === 'Cerrado') paso('Cerrado', creado + (hRes + 2) * HORA, admin, 'Validado y cerrado por administración');
      }
    });
  });
}

/* Siembra solo si la base está vacía */
function sembrarSiVacia() {
  const { n } = conexion().prepare('SELECT COUNT(*) AS n FROM usuarios').get();
  if (n === 0) {
    sembrar();
    return true;
  }
  return false;
}

module.exports = { sembrar, sembrarSiVacia, mensajeEstado, PASSWORD_DEMO };
