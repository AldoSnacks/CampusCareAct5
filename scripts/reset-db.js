/* =========================================================
   npm run reset-db
   Borra todos los registros y vuelve a cargar los datos de
   demostración. Detén el servidor antes de ejecutarlo.
   ========================================================= */
'use strict';
const { abrir, recrearEsquema, DB_PATH } = require('../src/db');
const { sembrar, PASSWORD_DEMO } = require('../src/seed');
const { vaciarCarpeta } = require('../src/fotos');

abrir();
recrearEsquema();
sembrar();
vaciarCarpeta();
console.log(`\n  Base de datos restablecida: ${DB_PATH}\n  Contraseña de las cuentas de demostración: ${PASSWORD_DEMO}\n`);
