require('dotenv').config();
const express = require('express');
const routerConsultas = require('./routes/Consultas');

const config = {
  hostname: process.env.HOSTNAME || 'localhost',
  port: process.env.PORT || 3000,
};

const app = express();

app
  .use(express.json())
  .use("/botCrmF5", routerConsultas)
  .listen(config.port, () => {
    console.log(`http://${config.hostname}:${config.port}`);
  });