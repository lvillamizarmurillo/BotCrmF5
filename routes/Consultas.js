// Importar el constructor de Router de Express para crear un manejador de rutas modular.
const { Router } = require('express');
// Importar el servicio (controlador) que contiene la lógica de negocio para las consultas de funcionarios.
const Funcionarios = require('../services/Consultas.js');

/**
 * @constant {Router} routerConsultas
 * @description Instancia del enrutador de Express para agrupar las rutas relacionadas con las consultas.
 * Este enrutador se montará en una ruta base en `app.js` (ej. '/botCrmF5').
 */
const routerConsultas = Router();

/**
 * @route GET /funcionarios
 * @description Define una ruta HTTP GET en '/funcionarios'.
 * Cuando se recibe una solicitud a esta ruta (ej. `http://localhost:3000/botCrmF5/funcionarios`),
 * se invoca el método `getFun` del servicio `Funcionarios`.
 *
 * @callback Funcionarios.getFun - El método que maneja la solicitud y la respuesta.
 */
routerConsultas.get("/funcionarios", Funcionarios.getFun);

// Exportar el enrutador para que pueda ser importado y utilizado en `app.js`.
module.exports = routerConsultas;