// Importaciones de módulos y librerías necesarias.
const { pool, poolConnect } = require('../../db/conection.js'); // Conexión a la base de datos.
const { WebClient } = require('@slack/web-api'); // Cliente de la API de Slack.
const sql = require('mssql'); // Driver de SQL Server.
const { format, subDays, eachDayOfInterval, getDay, isSunday, startOfWeek, getWeek, addDays, subMonths, startOfMonth, endOfMonth } = require('date-fns'); // Librería para manipulación de fechas.

// Inicialización del cliente de Slack.
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

/**
 * @constant {string[]} FUNCIONARIOS_AUTORIZADOS
 * @description Lista de códigos de funcionarios con permisos de administrador para este comando.
 */
const FUNCIONARIOS_AUTORIZADOS = ['LUDWINGV', 'KARLAC', '10', '11', '8'];

/**
 * @class ServicioUsuario
 * @description Encapsula la lógica para interactuar con la información de los usuarios.
 * Es idéntico al de `checkAll.js`, demostrando una oportunidad de refactorización para evitar duplicación.
 */
class ServicioUsuario {
  /**
   * Obtiene información de un usuario de Slack por su `username`.
   * @param {string} username - El `name` del usuario en Slack.
   * @returns {Promise<Object|null>} El objeto del miembro de Slack o `null`.
   */
  static async obtenerInformacionUsuarioPorUsername(username) {
    try {
      const respuesta = await slackClient.users.list();
      if (!respuesta.ok || !respuesta.members) {
        throw new Error('No se pudo obtener la lista de usuarios de Slack');
      }
      const usuario = respuesta.members.find(member =>
        member.name === username.toLowerCase()
      );
      return usuario || null;
    } catch (error) {
      console.error(`Error al obtener info del usuario con username ${username}:`, error);
      return null;
    }
  }

  /**
   * Obtiene todos los funcionarios activos de la base de datos con un email registrado.
   * @returns {Promise<Array<Object>>} Un array de objetos de funcionario.
   */
  static async obtenerTodosFuncionariosActivos() {
    await poolConnect;
    const resultado = await pool.request()
      .query(`
        SELECT FunCod, TipoDescanso, FunDirEmail 
        FROM Funcionarios 
        WHERE FunEst = 'A' AND FunDirEmail IS NOT NULL
      `);
    if (resultado.recordset.length === 0) {
      throw new Error('No se encontraron funcionarios activos con username registrado');
    }
    return resultado.recordset
      .filter(funcionario => {
        if (funcionario.TipoDescanso !== 1 && funcionario.TipoDescanso !== 2) {
          console.warn(`Funcionario ${funcionario.FunCod} tiene TipoDescanso inválido: ${funcionario.TipoDescanso}`);
          return false;
        }
        return true;
      })
      .map(funcionario => ({
        funCod: funcionario.FunCod,
        tipoDescanso: funcionario.TipoDescanso,
        username: funcionario.FunDirEmail
      }));
  }

  /**
   * Verifica si un funcionario tiene permisos de administrador.
   * @param {string} funCod - El código del funcionario.
   * @returns {boolean} `true` si está autorizado.
   */
  static tienePermisosAdministrador(funCod) {
    return FUNCIONARIOS_AUTORIZADOS.includes(funCod);
  }
}

/**
 * @class ServicioFechas
 * @description Agrupa métodos para la manipulación de fechas.
 * Idéntico a `checkAll.js`, candidato a ser un módulo reutilizable.
 */
class ServicioFechas {
  static obtenerFestivosColombia(año) {
    return [
      `${año}-01-01`, `${año}-01-06`, `${año}-03-19`, `${año}-05-01`,
      `${año}-06-29`, `${año}-07-20`, `${año}-08-07`, `${año}-08-18`,
      `${año}-10-13`, `${año}-11-03`, `${año}-11-17`, `${año}-12-08`,
      `${año}-12-25`
    ];
  }

  static obtenerDiasLaborables(fechaInicio, fechaFin, tipoDescanso, festivos) {
    const todosLosDias = eachDayOfInterval({ start: fechaInicio, end: fechaFin });
    return todosLosDias.filter(dia => {
      const fechaStr = format(dia, 'yyyy-MM-dd');
      return !festivos.includes(fechaStr) && !isSunday(dia) && !this.esSabadoDescanso(dia, tipoDescanso);
    });
  }

  static esSabadoDescanso(fecha, tipoDescanso) {
    if (getDay(fecha) !== 6) return false;
    const semanaDelAño = getWeek(fecha, { weekStartsOn: 1 });
    return (tipoDescanso === 1 && semanaDelAño % 2 !== 0) || (tipoDescanso === 2 && semanaDelAño % 2 === 0);
  }

  static agruparPorSemanas(dias) {
    if (dias.length === 0) return [];
    const semanasAgrupadas = new Map();
    dias.forEach(dia => {
      const inicioDeSemana = startOfWeek(dia.fechaObj, { weekStartsOn: 1 });
      const inicioDeSemanaStr = format(inicioDeSemana, 'yyyy-MM-dd');
      if (!semanasAgrupadas.has(inicioDeSemanaStr)) {
        semanasAgrupadas.set(inicioDeSemanaStr, []);
      }
      semanasAgrupadas.get(inicioDeSemanaStr).push(dia);
    });
    return Array.from(semanasAgrupadas.values()).sort((semanaA, semanaB) => semanaA[0].fechaObj - semanaB[0].fechaObj);
  }
}

/**
 * @class ServicioReporteTiempo
 * @description Contiene la lógica para consultar y calcular los tiempos registrados.
 * Idéntico a `checkAll.js`, candidato a ser un módulo reutilizable.
 */
class ServicioReporteTiempo {
  static async obtenerReporteDiario(funCod, fecha) {
    const fechaStr = format(fecha, 'yyyy-MM-dd');
    const esSabado = getDay(fecha) === 6;
    const horasRequeridas = esSabado ? 3 : 8.5;

    const resultado = await pool.request()
      .input('funCod', sql.VarChar, funCod)
      .input('fecha', sql.Date, fechaStr)
      .query(`
        SELECT SUM(tap.TickActConsHor) AS TotalHoras, SUM(tap.TickActConsMin) AS TotalMinutos
        FROM TicketActividad ta
        INNER JOIN TicketActividadProg tap ON ta.TickSec = tap.TickSec AND ta.TickActLinSec = tap.TickActLinSec
        INNER JOIN Ticket t ON ta.TickSec = t.TickSec
        WHERE ta.FunCod = @funCod AND CONVERT(DATE, tap.TickFechaProg) = @fecha
      `);

    const { TotalHoras, TotalMinutos } = resultado.recordset[0];
    let horasRegistradas = 0, minutosRegistrados = 0, mensaje = '', cumpleRequerimiento = false, faltante = '';

    if (TotalHoras !== null && TotalMinutos !== null) {
      horasRegistradas = TotalHoras + Math.floor(TotalMinutos / 60);
      minutosRegistrados = TotalMinutos % 60;
      const totalHorasDecimal = horasRegistradas + (minutosRegistrados / 60);
      cumpleRequerimiento = totalHorasDecimal >= horasRequeridas;
      
      if (!cumpleRequerimiento) {
        const horasFaltantes = Math.floor(horasRequeridas - totalHorasDecimal);
        const minutosFaltantes = Math.round((horasRequeridas - totalHorasDecimal - horasFaltantes) * 60);
        faltante = ` - *Faltan ${horasFaltantes}h ${minutosFaltantes}m*`;
      }
      mensaje = `*${horasRegistradas}h ${minutosRegistrados.toString().padStart(2, '0')}m*${faltante}`;
    } else {
      const horasFaltantes = Math.floor(horasRequeridas);
      const minutosFaltantes = Math.round((horasRequeridas - horasFaltantes) * 60);
      faltante = ` - *Faltan ${horasFaltantes}h ${minutosFaltantes}m*`;
      mensaje = `*Sin registro*${faltante}`;
    }
    return { fecha: format(fecha, 'dd/MM/yyyy'), fechaObj: fecha, mensaje, horas: horasRegistradas, minutos: minutosRegistrados, cumpleRequerimiento, esSabado };
  }

  static calcularResumenSemanal(diasSemana) {
    const totalHoras = diasSemana.reduce((sum, dia) => sum + dia.horas, 0);
    const totalMinutos = diasSemana.reduce((sum, dia) => sum + dia.minutos, 0);
    const horasFormateadas = totalHoras + Math.floor(totalMinutos / 60);
    const minutosFormateados = totalMinutos % 60;
    const diasLaborales = diasSemana.filter(dia => !dia.esSabado).length;
    const sabadosLaborables = diasSemana.filter(dia => dia.esSabado).length;
    const totalHorasRequeridas = (diasLaborales * 8.5) + (sabadosLaborables * 3);
    const horasRequeridasEntero = Math.floor(totalHorasRequeridas);
    const minutosRequeridos = Math.round((totalHorasRequeridas - horasRequeridasEntero) * 60);
    const totalHorasDecimal = horasFormateadas + (minutosFormateados / 60);
    const cumpleRequerimiento = totalHorasDecimal >= totalHorasRequeridas;
    return { totalHoras: horasFormateadas, totalMinutos: minutosFormateados, horasRequeridas: `${horasRequeridasEntero}h ${minutosRequeridos.toString().padStart(2, '0')}m`, cumpleRequerimiento };
  }

  static calcularResumenMensual(diasReporte, sabadosExcluidos, festivosExcluidos) {
    const resumenSemanal = this.calcularResumenSemanal(diasReporte);
    return { ...resumenSemanal, sabadosExcluidos, festivosExcluidos };
  }
}

/**
 * @class ConstructorMensajesSlack
 * @description Construye los bloques de mensajes de Slack para los reportes.
 * Idéntico a `checkAll.js`, ideal para refactorizar.
 */
class ConstructorMensajesSlack {
  static construirMensajeCompleto(nombreUsuario, funCod, tipoDescanso, fechaInicio, fechaFin, sabadosExcluidos, festivosExcluidos, semanas, resumenMensual) {
    const bloques = [];
    bloques.push({ type: 'header', text: { type: 'plain_text', text: `📅 Reporte Mensual - ${format(fechaInicio, 'MMMM yyyy')}` } });
    bloques.push({ type: 'section', text: { type: 'mrkdwn', text: `*Usuario:* ${nombreUsuario} (${funCod})\n*Tipo Descanso:* ${tipoDescanso}\n*Período:* ${format(fechaInicio, 'dd/MM/yyyy')} - ${format(fechaFin, 'dd/MM/yyyy')}\n*Sábados excluidos:* ${sabadosExcluidos}\n*Festivos excluidos:* ${festivosExcluidos}` } });
    bloques.push({ type: 'divider' });
    for (const [indice, semana] of semanas.entries()) {
      const numeroSemana = indice + 1;
      const primeraFecha = semana[0].fechaObj;
      const ultimaFecha = semana[semana.length - 1].fechaObj;
      const resumenSemana = ServicioReporteTiempo.calcularResumenSemanal(semana);
      const esUltimaSemana = indice === semanas.length - 1;
      bloques.push({ type: 'header', text: { type: 'plain_text', text: `📆 Semana ${numeroSemana} (${format(primeraFecha, 'dd/MM')} - ${format(ultimaFecha, 'dd/MM')})` } });
      const diasLaborales = semana.filter(dia => !dia.esSabado);
      if (diasLaborales.length > 0) {
        bloques.push({ type: 'section', text: { type: 'mrkdwn', text: '*📝 Días laborales (L-V) - Requerido: 8h 30m*' } });
        for (let i = 0; i < diasLaborales.length; i += 2) {
          const campos = diasLaborales.slice(i, i + 2).map(dia => ({ type: 'mrkdwn', text: `${dia.cumpleRequerimiento ? '✅' : '⚠️'} *${dia.fecha}*\n${dia.mensaje}` }));
          while (campos.length < 2) campos.push({ type: 'mrkdwn', text: ' ' });
          bloques.push({ type: 'section', fields: campos });
        }
      }
      const sabados = semana.filter(dia => dia.esSabado);
      if (sabados.length > 0) {
        bloques.push({ type: 'section', text: { type: 'mrkdwn', text: '*🛠️ Sábados laborables - Requerido: 3h*' } });
        sabados.forEach(dia => {
          bloques.push({ type: 'section', text: { type: 'mrkdwn', text: `${dia.cumpleRequerimiento ? '✅' : '⚠️'} *${dia.fecha}*\n${dia.mensaje}` } });
        });
      }
      if (!esUltimaSemana) {
        bloques.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `*📊 Total semana ${numeroSemana}:* ${resumenSemana.totalHoras}h ${resumenSemana.totalMinutos.toString().padStart(2, '0')}m (Requerido: ${resumenSemana.horasRequeridas}) ${resumenSemana.cumpleRequerimiento ? '✅' : '⚠️'}` }] });
      }
      bloques.push({ type: 'divider' });
    }
    bloques.push({ type: 'header', text: { type: 'plain_text', text: '📊 Resumen Mensual' } });
    bloques.push({ type: 'section', text: { type: 'mrkdwn', text: `*TOTAL MENSUAL:* ${resumenMensual.totalHoras}h ${resumenMensual.totalMinutos.toString().padStart(2, '0')}m ${resumenMensual.cumpleRequerimiento ? '✅' : '⚠️'}\n*Requerido:* ${resumenMensual.horasRequeridas}\n*Sábados excluidos:* ${resumenMensual.sabadosExcluidos}\n*Festivos excluidos:* ${resumenMensual.festivosExcluidos}` } });
    return bloques;
  }
  static construirMensajeError(error) { return [{ type: 'section', text: { type: 'mrkdwn', text: '❌ *Error al generar el reporte mensual*' } }, { type: 'section', text: { type: 'mrkdwn', text: `*Detalles:*\n${error.message}` } }]; }
  static construirMensajeSinPermisos() { return [{ type: 'section', text: { type: 'mrkdwn', text: '⛔ *Acceso denegado*' } }, { type: 'section', text: { type: 'mrkdwn', text: 'No tienes permisos para ejecutar este comando de administrador.\n\nPor favor, contacta al servicio técnico si necesitas acceso.' } }]; }
}


/**
 * @class ComandoReporteMensualMasivoPast
 * @description Orquesta la ejecución del comando `crm-check-all-admin-past`,
 * que genera y envía reportes masivos del mes anterior completo.
 */
class ComandoReporteMensualMasivoPast {
  /**
   * Método principal que se ejecuta al invocar el comando.
   * @param {Object} comando - Objeto del comando de Slack.
   * @param {Function} say - Función para enviar mensajes a Slack.
   */
  async execute(comando, say) {
    try {
      // 1. Verificar permisos del administrador que ejecuta el comando.
      const userId = comando.user_id;
      const usuarioSlack = await slackClient.users.info({ user: userId });
      if (!usuarioSlack.ok || !usuarioSlack.user) { throw new Error('No se pudo obtener información del usuario de Slack'); }
      
      await poolConnect;
      const resultado = await pool.request()
        .input('username', sql.VarChar, usuarioSlack.user.name)
        .query(`SELECT FunCod FROM Funcionarios WHERE FunEst = 'A' AND FunDirEmail = @username`);
      
      if (resultado.recordset.length === 0 || !ServicioUsuario.tienePermisosAdministrador(resultado.recordset[0].FunCod)) {
        return await say({ blocks: ConstructorMensajesSlack.construirMensajeSinPermisos() });
      }

      // 2. Obtener lista de todos los funcionarios activos.
      const funcionarios = await ServicioUsuario.obtenerTodosFuncionariosActivos();
      
      // 3. Configurar fechas para el reporte: mes anterior completo.
      const hoy = new Date();
      const primerDiaMesAnterior = startOfMonth(subMonths(hoy, 1));
      const ultimoDiaMesAnterior = endOfMonth(subMonths(hoy, 1));
      const festivos = ServicioFechas.obtenerFestivosColombia(primerDiaMesAnterior.getFullYear());

      // 4. Enviar mensaje de inicio del proceso al administrador.
      await say({ text: `Iniciando envío masivo de reportes a ${funcionarios.length} funcionarios`, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `⏳ *Iniciando envío masivo de reportes mensuales*\nSe enviarán reportes del mes anterior (${format(primerDiaMesAnterior, 'MMMM yyyy')}) a ${funcionarios.length} funcionarios activos` } }] });

      let usuariosConPendientes = 0, usuariosAlDia = 0;
      const listaUsuariosAlDia = [], listaUsuariosConPendientes = [];

      // 5. Procesar cada funcionario.
      for (const funcionario of funcionarios) {
        try {
          const userInfo = await ServicioUsuario.obtenerInformacionUsuarioPorUsername(funcionario.username);
          if (!userInfo) {
            console.warn(`⚠️ No se encontró usuario en Slack con username: ${funcionario.username}`);
            continue;
          }

          const nombreUsuario = userInfo.real_name || userInfo.name || 'Usuario';
          const userChannelId = userInfo.id;
          const diasLaborables = ServicioFechas.obtenerDiasLaborables(primerDiaMesAnterior, ultimoDiaMesAnterior, funcionario.tipoDescanso, festivos);
          
          const reportesDiarios = [];
          for (const dia of diasLaborables) {
            const reporte = await ServicioReporteTiempo.obtenerReporteDiario(funcionario.funCod, dia);
            reportesDiarios.push(reporte);
          }

          const sabadosExcluidos = eachDayOfInterval({ start: primerDiaMesAnterior, end: ultimoDiaMesAnterior }).filter(dia => getDay(dia) === 6 && ServicioFechas.esSabadoDescanso(dia, funcionario.tipoDescanso)).length;
          const festivosExcluidos = festivos.filter(f => { const fechaFestivo = new Date(f); return fechaFestivo >= primerDiaMesAnterior && fechaFestivo <= ultimoDiaMesAnterior; }).length;
          const resumenMensual = ServicioReporteTiempo.calcularResumenMensual(reportesDiarios, sabadosExcluidos, festivosExcluidos);

          // 6. Decidir si enviar el reporte detallado.
          // Si el total de horas es igual o mayor al requerido, no se envía nada.
          if (resumenMensual.cumpleRequerimiento) {
            console.log(`✅ Usuario ${nombreUsuario} (${funcionario.funCod}) está al día.`);
            usuariosAlDia++;
            listaUsuariosAlDia.push(nombreUsuario);
            continue; // Saltar al siguiente funcionario.
          }
          
          // 7. Si no cumple, se construye y envía el mensaje detallado al usuario.
          usuariosConPendientes++;
          listaUsuariosConPendientes.push(
            `*${nombreUsuario}*: ${resumenMensual.totalHoras}h ${String(resumenMensual.totalMinutos).padStart(2, '0')}m de ${resumenMensual.horasRequeridas}`
          );

          const semanas = ServicioFechas.agruparPorSemanas(reportesDiarios);
          const bloquesMensaje = ConstructorMensajesSlack.construirMensajeCompleto(nombreUsuario, funcionario.funCod, funcionario.tipoDescanso, primerDiaMesAnterior, ultimoDiaMesAnterior, sabadosExcluidos, festivosExcluidos, semanas, resumenMensual);
          await slackClient.chat.postMessage({ channel: userChannelId, text: `Reporte mensual completo para ${nombreUsuario}`, blocks: bloquesMensaje });

        } catch (error) {
          console.error(`🚨 Error procesando funcionario ${funcionario.funCod}:`, error);
        }
      }

      // 8. Construir y enviar el resumen final al administrador.
      const bloquesResumenFinal = [
        { type: 'section', text: { type: 'mrkdwn', text: `✅ *Envío masivo de reportes completado*` } },
        { type: 'section', text: { type: 'mrkdwn', text: `*Total de funcionarios revisados:* ${funcionarios.length}\n*Reportes enviados (con pendientes):* ${usuariosConPendientes}\n*Funcionarios al día (sin reporte):* ${usuariosAlDia}` } },
        { type: 'divider' }
      ];

      if (listaUsuariosConPendientes.length > 0) {
        bloquesResumenFinal.push({
          type: 'section',
          text: { type: 'mrkdwn', text: `⚠️ *Funcionarios con horas pendientes (${listaUsuariosConPendientes.length}):*\n` + listaUsuariosConPendientes.join('\n') }
        });
      }

      if (listaUsuariosAlDia.length > 0) {
        bloquesResumenFinal.push({
          type: 'section',
          text: { type: 'mrkdwn', text: `✅ *Funcionarios al día (${listaUsuariosAlDia.length}):*\n` + listaUsuariosAlDia.join('\n') }
        });
      }
      
      bloquesResumenFinal.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `Se enviaron reportes detallados solo a los usuarios con horas pendientes.` }]
      });

      await say({ text: 'Resumen del envío masivo de reportes', blocks: bloquesResumenFinal });

    } catch (error) {
      console.error('🚨 Error en comando masivo:', error);
      await say({ text: '❌ Error al ejecutar el comando masivo', blocks: ConstructorMensajesSlack.construirMensajeError(error) });
    }
  }
}

// Exportar la clase principal para su uso en `botCore.js`.
module.exports = ComandoReporteMensualMasivoPast;