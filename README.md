# CampusCare · Backend + Base de datos

Sistema de reporte de incidencias de infraestructura universitaria.

| Capa | Tecnología |
|---|---|
| Frontend | HTML, CSS y JavaScript (carpeta `public/`) |
| Backend | Node.js + Express (API REST) |
| Base de datos | SQLite (archivo `database/campuscare.db`) |
| Seguridad | JWT (sesión de 8 h) y contraseñas cifradas con bcrypt |
| Tiempo real | Server-Sent Events (avisos instantáneos entre usuarios) |
| Caché | Service Worker (PWA instalable y sin conexión), encabezados HTTP y caché en memoria del servidor |

---

## 1. Requisitos

**Node.js 22 LTS o más reciente** (recomendado: la versión LTS actual).
Descárgalo de <https://nodejs.org>, instálalo con "Siguiente, Siguiente" y **reinicia VS Code**.

Para comprobar la versión, abre una terminal y escribe:

```
node -v
```

Debe mostrar `v22...` o un número mayor.

> SQLite viene incluido dentro de Node.js 22+. No hay que instalar MySQL, XAMPP ni ningún servidor de base de datos.

## 2. Cómo ejecutarlo (Windows + VS Code)

1. Descomprime el `.zip` y abre la carpeta `CampusCare-Fullstack` en VS Code (**Archivo → Abrir carpeta**).
2. Abre una terminal: **Terminal → Nuevo terminal**.
3. Instala las dependencias (solo la primera vez):
   ```
   npm install
   ```
4. Inicia el servidor:
   ```
   npm start
   ```
5. Abre en el navegador **http://localhost:3000**.

Para detener el servidor, presiona `Ctrl + C` en la terminal.

**Importante:** ya no se usa Live Server. La página la entrega el propio servidor en el puerto 3000.

**Desde tu celular:** conéctalo a la misma red Wi-Fi que la computadora y abre la dirección que aparece en la terminal: `En tu celular: http://192.168.x.x:3000`.

### Si aparece "la ejecución de scripts está deshabilitada"

Esto lo provoca PowerShell en Windows. Tienes dos opciones:

- En la terminal de VS Code, cambia el tipo de terminal a **Command Prompt** (flecha junto al **+**) y vuelve a ejecutar los comandos.
- O ejecuta una sola vez este comando y vuelve a intentarlo:
  ```
  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
  ```

### Otros problemas comunes

| Mensaje | Solución |
|---|---|
| `Tu versión de Node.js no incluye SQLite` | Instala Node.js 22 LTS o más reciente. |
| `El puerto 3000 ya está en uso` | Ya hay otra terminal con el servidor abierto: ciérrala. |
| `No hay conexión con el servidor` (en la página) | El servidor está apagado: ejecuta `npm start`. |
| `La base de datos está ocupada` | Tienes cambios sin guardar en DB Browser: presiona "Escribir cambios". |

## 3. Cuentas de demostración

Contraseña de todas: **`Campus2026`**

| Rol | Correo |
|---|---|
| Alumno / Docente | alumno@institucion.edu.mx · docente@institucion.edu.mx |
| Personal de Mantenimiento | tecnico@institucion.edu.mx · tecnico2@ · tecnico3@ |
| Administrador | admin@institucion.edu.mx |

También puedes crear cuentas nuevas con **"Crear cuenta institucional"** en la pantalla de inicio de sesión.

---

## 4. La base de datos

El archivo es `database/campuscare.db`. Se crea solo la primera vez que inicias el servidor, con las tablas de `database/schema.sql` y datos de ejemplo.

| Tabla | Qué guarda | Formulario que la llena |
|---|---|---|
| `usuarios` | Cuentas, rol y contraseña cifrada | Crear cuenta · Usuarios (admin) |
| `edificios` | Edificios del campus | Catálogo del campus |
| `niveles` | Pisos de cada edificio | Catálogo del campus |
| `espacios` | Aulas, laboratorios y áreas | Catálogo del campus |
| `categorias` | Tipos de falla | Catálogo del campus |
| `severidades` | Baja / Media / Crítica y su SLA en horas | Catálogo → Severidades y SLA |
| `tickets` | Incidencias reportadas | Reportar incidencia |
| `resoluciones` | Evidencia del técnico (foto, notas, materiales) | Registrar solución |
| `historial_estados` | Cada cambio de estado (trazabilidad) | Asignar · Iniciar · Resolver · Cerrar · Rechazar |
| `notificaciones` | Avisos para cada usuario | Se generan solas en cada cambio |
| `accesos` | Bitácora de inicios de sesión (exitosos y fallidos) | Iniciar sesión · Crear cuenta |
| `vista_reporte_tickets` | **Vista** que une todo en un reporte legible | (solo lectura) |

Además, la base de datos incluye:

- **Llaves foráneas.** Por ejemplo, no se puede borrar un espacio que tiene tickets (`RESTRICT`). En cambio, al borrar un ticket se borran también su historial, su evidencia y sus notificaciones (`CASCADE`).
- **Reglas `CHECK`.** Solo acepta correos `@institucion.edu.mx`, los tres roles válidos y los seis estados válidos.
- **Trigger `tickets_folio`.** Genera el folio `CC-1001`, `CC-1002`, etc. automáticamente.
- **Índices** para acelerar las búsquedas.

Las fotografías se guardan como archivos en la carpeta `uploads/`. En la base de datos solo se guarda su ruta.

### Cómo mostrar la base de datos a tu docente

**Opción A: dentro de la aplicación.** Entra como Administrador y abre **Base de datos**. Ahí puedes:

- Ver cada tabla con sus registros, buscar y cambiar de página.
- **Agregar, editar y eliminar** registros de cualquier tabla. Las reglas de la base se respetan, así que si un borrado no está permitido verás el aviso de la llave foránea.
- Ver la **estructura** de cada tabla (columnas, llave primaria, llaves foráneas y el `CREATE TABLE`).
- Usar la **Consola SQL** para ejecutar `SELECT`, con consultas de ejemplo listas.
- **Descargar un respaldo** `.db` y **restablecer** los datos de demostración.

**Opción B: con DB Browser for SQLite** (gratis: <https://sqlitebrowser.org>).

1. Abre `database/campuscare.db`.
2. En la pestaña **Hojas de datos** puedes ver y borrar registros.
3. Después de modificar algo, presiona **Escribir cambios** (`Ctrl + S`).
4. En la aplicación, presiona **Actualizar** para ver el cambio.

**Opción C: en VS Code.** Instala la extensión **SQLite Viewer** y da clic en `campuscare.db`.

### Guion sugerido para la exposición

1. Entra como alumno y **crea una cuenta nueva** → muéstrala en la tabla `usuarios` y en `accesos`.
2. **Reporta una incidencia** con foto → aparece en `tickets` (con folio automático), en `historial_estados` y en `notificaciones`.
3. Entra como administrador en otra pestaña y **asigna un técnico** → nueva fila en `historial_estados` y el alumno recibe el aviso al instante.
4. Entra como técnico, **inicia y resuelve** con foto → fila nueva en `resoluciones`.
5. Abre la vista `vista_reporte_tickets` para ver el reporte completo con el cumplimiento del SLA.
6. **Borra** registros:
   - Una notificación, desde la campana → Avisos.
   - Un reporte en estado Abierto, con el botón "Cancelar reporte".
   - Un usuario, desde Usuarios: se borran en cascada sus tickets.
7. Intenta borrar un edificio o una categoría con tickets → la base de datos lo impide (llave foránea).
8. Prueba una consulta en la Consola SQL, por ejemplo **Tickets por estado**.

Para volver a los datos originales usa **Restablecer datos de demostración** en el panel. También puedes detener el servidor y ejecutar:

```
npm run reset-db
```

---

## 5. API REST

Todas las rutas (menos las de autenticación y el resumen público) requieren el encabezado `Authorization: Bearer <token>`.

| Método | Ruta | Descripción | Rol |
|---|---|---|---|
| POST | `/api/auth/login` | Iniciar sesión | Público |
| POST | `/api/auth/registro` | Crear cuenta | Público |
| GET | `/api/auth/yo` | Datos de la sesión | Todos |
| GET | `/api/catalogo` | Edificios, niveles, espacios, categorías, severidades | Todos |
| GET | `/api/tickets` | Tickets (según el rol) | Todos |
| POST | `/api/tickets` | Levantar incidencia | Alumno / Docente, Admin |
| POST | `/api/tickets/:folio/transicion` | Cambiar estado | Según el estado |
| DELETE | `/api/tickets/:folio` | Cancelar o eliminar ticket | Dueño (si está Abierto), Admin |
| GET | `/api/notificaciones` | Mis notificaciones | Todos |
| PATCH | `/api/notificaciones/:id/leida` | Marcar como leída | Todos |
| DELETE | `/api/notificaciones/:id` | Borrar notificación | Todos |
| GET / POST / PUT / DELETE | `/api/usuarios` | Administrar cuentas | Admin |
| POST / PUT / DELETE | `/api/catalogo/edificios`, `niveles`, `espacios`, `categorias` | Administrar catálogo | Admin |
| PUT | `/api/catalogo/severidades/:nombre` | Cambiar SLA | Admin |
| GET | `/api/admin/tablas` | Tablas y número de registros | Admin |
| GET / POST / PUT / DELETE | `/api/admin/tablas/:tabla[/:id]` | CRUD de cualquier tabla | Admin |
| POST | `/api/admin/consulta` | Consola SQL (solo SELECT) | Admin |
| GET | `/api/admin/respaldo` | Descargar el archivo .db | Admin |
| POST | `/api/admin/reset` | Restablecer datos de demostración | Admin |
| GET | `/api/eventos` | Canal de tiempo real (SSE) | Todos |

## 6. Estructura del proyecto

```
CampusCare-Fullstack/
├── server.js              Servidor Express (punto de entrada)
├── package.json           Dependencias y comandos npm
├── render.yaml            Configuración para publicar en Render
├── database/
│   ├── schema.sql         Tablas, llaves, trigger, índices y vista
│   └── campuscare.db      La base de datos (se crea sola)
├── src/
│   ├── db.js              Conexión a SQLite
│   ├── seed.js            Datos de demostración
│   ├── auth.js            JWT y permisos por rol
│   ├── tickets.js         Máquina de estados y reglas de negocio
│   ├── fotos.js           Guardado de fotografías
│   ├── eventos.js         Tiempo real (Server-Sent Events)
│   └── cache.js           Caché en memoria del servidor
├── routes/                Rutas de la API (auth, tickets, catálogo, usuarios, notificaciones, admin)
├── scripts/reset-db.js    Restablece la base de datos
├── uploads/               Fotografías subidas
└── public/                Frontend
    ├── index.html, styles.css, app.js, admin.js
    ├── pwa.js             Registro del Service Worker, instalación y panel de caché
    ├── sw.js              Service Worker (estrategias de caché)
    ├── manifest.json, offline.html, icons/, img/
```

## 7. Requerimientos cubiertos

- **RF-01** Inicio de sesión solo con `@institucion.edu.mx`, token JWT firmado por el servidor y tres roles validados en cada petición.
- **RF-02** Incidencia con ubicación jerárquica desde el catálogo de la base, foto, categoría, severidad y descripción.
- **RF-03** Máquina de estados en el servidor, con su historial en `historial_estados`.
- **RF-04** El servidor rechaza "Resuelto" si falta la foto, las notas o los materiales.
- **RF-05** Notificaciones guardadas en la base y entregadas al instante por SSE, más avisos push del navegador.
- **RF-06** Dashboard con filtros y exportación a CSV.
- **RF-07** MTTR, porcentaje de SLA y mapa de calor calculados con los datos reales.

---

## 8. Publicarlo en internet (hosting)

Esta app necesita un hosting que ejecute **Node.js**. GitHub Pages, Netlify o InfinityFree no sirven, porque solo publican páginas estáticas.

### Paso previo: subir el proyecto a GitHub
1. Crea un repositorio nuevo en <https://github.com/new> (por ejemplo `campuscare`).
2. Da clic en **uploading an existing file** y arrastra **el contenido** de la carpeta `CampusCare-Fullstack`.
   **No subas** `node_modules` ni `database/campuscare.db`.
3. Presiona **Commit changes**.

### Opción A: Render (gratis, sin tarjeta)
1. Entra a <https://render.com> con tu cuenta de GitHub.
2. Ve a **New → Web Service** y elige tu repositorio.
3. Configura:
   - Language: **Node**
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance type: **Free**
4. En **Environment Variables** agrega:
   - `JWT_SECRET` = una frase larga y secreta
   - `NODE_ENV` = `production`
5. Presiona **Deploy**. Te dará una dirección como `https://campuscare.onrender.com`.

En el plan gratis, el servidor se apaga después de 15 minutos sin visitas y tarda cerca de un minuto en volver a despertar. Al apagarse o al volver a desplegar, **la base de datos regresa a los datos de demostración**. Abre la página unos minutos antes de exponer.

### Opción B: Railway (los datos se conservan)
1. Entra a <https://railway.com> con GitHub y elige **New Project → Deploy from GitHub repo**.
2. En el servicio, agrega un **Volume** con *Mount path* `/data`.
3. En **Variables** agrega:
   - `JWT_SECRET` = una frase secreta
   - `NODE_ENV` = `production`
   - `DB_PATH` = `/data/campuscare.db`
   - `UPLOADS_DIR` = `/data/uploads`
4. En **Settings → Networking**, presiona **Generate Domain** para obtener tu dirección pública.

Con el volumen, los usuarios, reportes y fotos se mantienen aunque el servidor se reinicie. Railway da una prueba con crédito limitado; revisa su plan vigente.

---

## 8. Caché (requisito de la docente)

CampusCare usa caché en **tres niveles**. Todos se pueden mostrar en la vista **Caché y sin conexión** (rol Administrador).

### Nivel 1: caché del navegador (Service Worker)

El archivo `public/sw.js` guarda archivos en el dispositivo con la **Cache Storage API**:

| Caché | Estrategia | Qué guarda |
|---|---|---|
| `campuscare-app-v2.2.0` | Stale-while-revalidate | HTML, CSS, JS e íconos. Se precargan al instalar y se sirven al instante. |
| `campuscare-imagenes` | Cache-first | Imágenes y fotos de evidencia (máximo 80). |
| `campuscare-api` | Network-first | Últimas respuestas de la API, para consultar sin internet. Se borra al cerrar sesión. |

**Consecuencias:**

- La app **funciona sin conexión**: muestra la última información guardada y una barra de aviso. Para comprobarlo, en Chrome abre `F12 → Network → Offline` y recarga.
- Es **instalable** en el celular y en la computadora (PWA), gracias a `manifest.json` y la carpeta `icons/`.
- Cuando publicas cambios aparece el aviso **"Hay una versión nueva"** con el botón para actualizar.

> **Cada vez que cambies el frontend**, sube la constante `VERSION` en `public/sw.js` (por ejemplo `v2.2.1`). Así los navegadores descartan la caché anterior.

En Chrome también puedes verlo en `F12 → Application → Service Workers / Cache storage`.

### Nivel 2: caché HTTP (encabezados que envía el servidor)

| Recurso | Cache-Control |
|---|---|
| `index.html`, `sw.js`, manifest | `no-cache` (siempre revisa si hay versión nueva) |
| `.css`, `.js` | `max-age=0, must-revalidate` + ETag (el servidor responde 304 si no cambió) |
| `img/` | `max-age=604800` (7 días) |
| `uploads/` (fotos) | `max-age` de 30 días, `immutable` (nombre único, nunca cambian) |
| `/api/*` | `no-store` (datos personales); el catálogo usa `private, no-cache` + ETag |

### Nivel 3: caché del servidor (memoria)

`src/cache.js` guarda en memoria el **catálogo** (5 min) y el **resumen público** (1 min). La respuesta incluye el encabezado `X-Cache: HIT` (vino de la caché) o `MISS` (se leyó de SQLite). La caché se **invalida automáticamente** cada vez que alguien modifica la base de datos. El panel muestra los aciertos, los fallos y la tasa de aciertos.

---

## 9. Publicar en internet (hosting)

Este proyecto tiene **servidor Node.js y base de datos**, así que **no funciona en GitHub Pages** (Pages solo sirve archivos estáticos). Necesitas un hosting que ejecute Node.js. Aquí tienes dos opciones gratuitas.

### Paso previo: subir el proyecto a GitHub

1. Crea una cuenta en <https://github.com> (si no tienes).
2. Da clic en **New repository**, ponle de nombre `campuscare`, déjalo **Public** y presiona **Create repository**.
3. En la página del repositorio, da clic en **uploading an existing file**.
4. Abre la carpeta del proyecto en el Explorador de Windows, selecciona **todo su contenido** y arrástralo a la página.
   - **No subas** la carpeta `node_modules` ni el archivo `database/campuscare.db` (si existen).
   - Sí sube la carpeta `uploads` (contiene `.gitkeep`) y el archivo `.gitignore`.
5. Presiona **Commit changes**.

### Opción A: Render (gratis, la más sencilla)

1. Entra a <https://render.com> y regístrate con tu cuenta de GitHub.
2. Da clic en **New → Blueprint** y elige tu repositorio `campuscare`. Render lee el archivo `render.yaml` y lo configura solo.

   Si prefieres hacerlo a mano: **New → Web Service**, elige el repositorio y llena estos datos:
   - Runtime: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance type: `Free`
   - En **Environment** agrega la variable `JWT_SECRET` con cualquier texto largo.
3. Presiona **Deploy**. En 2 o 3 minutos tendrás una dirección como `https://campuscare-xxxx.onrender.com`.

**Ten en cuenta lo siguiente sobre el plan gratis de Render:**

- El servicio **se duerme tras 15 minutos sin visitas** y tarda cerca de 1 minuto en despertar. Abre la página unos minutos antes de tu exposición.
- El disco es **temporal**: al dormirse o al volver a publicar, la base de datos y las fotos se borran. CampusCare **vuelve a cargar los datos de demostración automáticamente**, así que siempre funciona. Lo que captures durante la exposición se conserva mientras el servicio siga activo.
- Cada vez que subas cambios a GitHub, Render vuelve a publicar solo.

### Opción B: Railway (los datos se conservan)

1. Entra a <https://railway.com> y regístrate con GitHub.
2. Da clic en **New Project → Deploy from GitHub repo** y elige `campuscare`.
3. En el servicio:
   1. Abre **Settings → Networking → Generate Domain** para obtener la URL pública.
   2. Agrega un **Volume** (clic derecho en el servicio → Attach volume) con *Mount path* `/data`.
   3. En **Variables** agrega:
      - `DB_PATH` = `/data/campuscare.db`
      - `UPLOADS_DIR` = `/data/uploads`
      - `JWT_SECRET` = cualquier texto largo
4. Railway vuelve a publicar y la base de datos queda guardada en el volumen.

> Railway da un periodo de prueba con crédito y después un plan gratuito con crédito mensual limitado. Revisa sus condiciones actuales al registrarte.

### Después de publicar

- Comparte la URL `https://...` con tu docente.
- Como el hosting usa **HTTPS**, el Service Worker y la instalación de la app funcionan también en el celular.
- Para actualizar la página, sube los archivos modificados a GitHub (**Add file → Upload files**) y recuerda subir la `VERSION` en `sw.js`.

### Variables de entorno disponibles

| Variable | Para qué sirve | Valor por defecto |
|---|---|---|
| `PORT` | Puerto del servidor (el hosting lo asigna) | `3000` |
| `JWT_SECRET` | Clave para firmar los tokens | Una clave de desarrollo |
| `DB_PATH` | Ruta del archivo de la base de datos | `database/campuscare.db` |
| `UPLOADS_DIR` | Carpeta de las fotografías | `uploads/` |

---

## 10. Versión 3: mapa de calor interactivo y lista de cotejo PWA

La nueva sección **Mapa de calor** (menú lateral; en el celular, "Mapa") está disponible para el **Administrador** y para el **Personal de Mantenimiento**. Tiene tres pestañas:

| Pestaña | Qué hace |
|---|---|
| **Mapa** | Mapa Edificio × Categoría o Edificio × Nivel, calculado con SQL en el servidor. Tiene filtros de periodo, severidad y estado, umbral de "zona caliente" guardado en la BD, clic en una celda para ver sus reportes, actualización en vivo y modo sin conexión. |
| **Historial** | Instantáneas del mapa guardadas en la tabla `mapa_calor_historial`: crear, consultar, editar la nota y eliminar. |
| **Lista de cotejo PWA** | Los 17 puntos de evaluación verificados en vivo, con botones para demostrar cada uno. |

### Nuevas tablas

`configuracion`, `mapa_calor_historial`, `mapa_calor_alertas` y `push_suscripciones`. Se crean solas al iniciar el servidor, sin borrar tus datos.

### Nuevos endpoints

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/mapa-calor?vista=&dias=&severidad=&estado=` | Matriz del mapa (valida los parámetros: 400 si son incorrectos) |
| GET | `/api/mapa-calor/detalle?fila=&columna=` | Tickets de una celda |
| GET / PUT | `/api/mapa-calor/config` | Umbral de zona caliente |
| GET / POST / PATCH / DELETE | `/api/mapa-calor/historial[/:id]` | CRUD de instantáneas |
| GET | `/api/mapa-calor/alertas` | Alertas de zona caliente |
| GET | `/api/mapa-calor/diagnostico` | Datos para la lista de cotejo |
| GET | `/api/push/clave` | Llave pública VAPID |
| POST / DELETE | `/api/push/suscripcion` | Registrar o quitar un dispositivo |
| POST | `/api/push/prueba` | Enviar una notificación push de prueba |

### Notificaciones push

Se envían con el estándar **Web Push + VAPID**, sin librerías extra. Las llaves se crean solas en `database/vapid.json`.

Se generan avisos push en estos casos:
- Cada cambio de estado de un ticket.
- Cuando un reporte nuevo hace que una celda del mapa alcance el umbral (**zona caliente**).

En **Render**, copia los dos valores de `database/vapid.json` a las variables de entorno `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY`. Así las suscripciones no se pierden cada vez que el servicio se reinicia.

### Cambios hechos fuera de la app

El servidor revisa cada 2 segundos `PRAGMA data_version`. Si editas la base de datos con DB Browser o SQLite Viewer y guardas, el mapa de calor se actualiza solo en todos los navegadores abiertos.
