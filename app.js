// Cargar las variables de entorno desde el archivo .env al inicio de la aplicación.
require('dotenv').config();

// Importar el framework Express para la creación del servidor y la gestión de rutas.
const express = require('express');
// Importar el enrutador que maneja las consultas a la base de datos.
const routerConsultas = require('./routes/Consultas');

/**
 * @constant {Object} config
 * @description Objeto de configuración para el servidor.
 * Toma los valores del archivo .env o usa valores por defecto si no están definidos.
 * @property {string} hostname - El nombre del host del servidor (ej. 'localhost').
 * @property {number} port - El puerto en el que escuchará el servidor (ej. 3000).
 */
const config = {
  hostname: process.env.HOSTNAME || 'localhost',
  port: process.env.PORT || 3000,
};

// Crear una instancia de la aplicación Express.
const app = express();

// --- Configuración de Middlewares y Rutas ---
app
  // Middleware para parsear automáticamente las solicitudes entrantes con formato JSON.
  .use(express.json())
  // Montar el enrutador de consultas en la ruta base '/botCrmF5'.
  // Todas las rutas definidas en `routerConsultas` estarán prefijadas con '/botCrmF5'.
  .use("/botCrmF5", routerConsultas)
  // Iniciar el servidor para que escuche en el puerto y hostname configurados.
  .listen(config.port, () => {
    // Mensaje de confirmación en la consola una vez que el servidor está listo.
    console.log(`🚀 Servidor Express escuchando en http://${config.hostname}:${config.port}`);
    console.log(`➡️ Endpoint de funcionarios disponible en http://${config.hostname}:${config.port}/botCrmF5/funcionarios`);
  });