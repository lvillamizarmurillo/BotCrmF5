// Importar el driver de SQL Server para Node.js.
const sql = require('mssql');
// Cargar las variables de entorno desde el archivo .env.
require('dotenv').config();

/**
 * @constant {Object} dbConfig
 * @description Objeto de configuración para la conexión a la base de datos SQL Server.
 * Lee las credenciales y detalles del servidor desde las variables de entorno
 * para mantener la seguridad y flexibilidad.
 */
const dbConfig = {
  user: process.env.DB_USER,          // Usuario de la base de datos.
  password: process.env.DB_PASS,      // Contraseña del usuario.
  server: process.env.DB_SERVER,      // Dirección del servidor de la base de datos.
  database: process.env.DB_NAME,      // Nombre de la base de datos a la que se conectará.
  options: {
    encrypt: false,                   // Deshabilitar la encriptación para conexiones locales o no SSL.
    trustServerCertificate: true      // Confiar en el certificado del servidor (útil para desarrollo local).
  }
};

/**
 * @constant {sql.ConnectionPool} pool
 * @description Crea una instancia de un pool de conexiones a la base de datos.
 * El pool gestiona múltiples conexiones para mejorar el rendimiento y la eficiencia,
 * reutilizando conexiones en lugar de abrir y cerrar una nueva por cada consulta.
 */
const pool = new sql.ConnectionPool(dbConfig);

/**
 * @constant {Promise<sql.ConnectionPool>} poolConnect
 * @description Inicia el proceso de conexión del pool a la base de datos.
 * Esta es una promesa que se resuelve una vez que el pool ha establecido su conexión inicial.
 * Se exporta para que otros módulos puedan esperar (`await`) a que la conexión esté lista
 * antes de intentar realizar consultas, evitando errores de conexión.
 */
const poolConnect = pool.connect();

/**
 * @module exports
 * @description Exporta los componentes necesarios para interactuar con la base de datos.
 * @property {Object} sql - El objeto `mssql` completo, útil para acceder a tipos de datos (ej. sql.Int, sql.VarChar).
 * @property {sql.ConnectionPool} pool - La instancia del pool de conexiones, para realizar consultas.
 * @property {Promise<sql.ConnectionPool>} poolConnect - La promesa de conexión, para asegurar que el pool está listo.
 */
module.exports = { sql, pool, poolConnect };