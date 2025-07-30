const { Router } = require('express');
const Funcionarios = require('../services/Consultas.js');

const routerConsultas = Router();

routerConsultas.get("/funcionarios", Funcionarios.getFun);

module.exports = routerConsultas;