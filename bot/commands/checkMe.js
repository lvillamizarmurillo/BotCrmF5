// Importaciones de módulos y librerías necesarias.
const { pool, poolConnect } = require('../../db/conection.js'); // Conexión a la base de datos.
const { WebClient } = require('@slack/web-api'); // Cliente de la API de Slack.
const sql = require('mssql'); // Driver de SQL Server.
const { format, subDays, eachDayOfInterval, getDay, isSunday, startOfWeek, endOfWeek, addDays, getWeek } = require('date-fns'); // Librería para manipulación de fechas.

// Inicialización del cliente de Slack.
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

/**
 * @class ServicioUsuario
 * @description Encapsula la lógica para obtener información del usuario desde Slack y la base de datos.
 */
class ServicioUsuario {
  /**
   * Obtiene la información del perfil de un usuario de Slack a partir de su ID.
   * @param {string} userId - El ID del usuario en Slack (ej. 'U123ABC456').
   * @returns {Promise<Object>} El objeto `user` de la API de Slack.
   */
  static async obtenerInformacionUsuario(userId) {
    try {
      if (!userId) {
        throw new Error('No se proporcionó un ID de usuario');
      }
      const respuesta = await slackClient.users.info({ user: userId });
      return respuesta.user;
    } catch (error) {
      console.error('Error al obtener info del usuario:', error);
      // Devuelve un objeto por defecto en caso de error para evitar fallos.
      return { 
        real_name: 'Usuario', 
        name: 'usuario_desconocido',
        profile: { email: 'usuario@desconocido.com' }
      };
    }
  }

  /**
   * Obtiene el código de funcionario y su tipo de descanso desde la base de datos usando su email.
   * @param {string} email - El email del usuario, que debe coincidir con `FunDirEmail`.
   * @returns {Promise<Object>} Un objeto con `funCod` y `tipoDescanso`.
   */
  static async obtenerDatosEmpleado(email) {
    await poolConnect;
    const resultado = await pool.request()
      .input('email', sql.VarChar(254), email)
      .query(`
        SELECT FunCod, TipoDescanso 
        FROM Funcionarios 
        WHERE FunDirEmail = @email
        AND FunEst = 'A'
      `);

    if (resultado.recordset.length === 0) {
      throw new Error(`No se encontró un funcionario activo con email ${email}`);
    }

    const { FunCod, TipoDescanso } = resultado.recordset[0];
    
    if (TipoDescanso !== 1 && TipoDescanso !== 2) {
      throw new Error(`TipoDescanso inválido (${TipoDescanso}). Debe ser 1 o 2.`);
    }
    
    return { funCod: FunCod, tipoDescanso: TipoDescanso };
  }
}

/**
 * @class ServicioFechas
 * @description Agrupa métodos estáticos para la manipulación y cálculo de fechas.
 * Similar a otros archivos, ideal para ser refactorizado en un módulo común.
 */
class ServicioFechas {
  static obtenerFestivosColombia(año) {
    return [
      `${año}-01-01`, `${año}-01-06`, `${año}-03-19`, 
      `${año}-05-01`, `${año}-06-29`, `${año}-07-20`,
      `${año}-08-07`, `${año}-08-18`, `${año}-10-13`,
      `${año}-11-03`, `${año}-11-17`, `${año}-12-08`,
      `${año}-12-25`
    ];
  }

  static obtenerDiasLaborables(fechaInicio, fechaFin, tipoDescanso, festivos) {
    const todosLosDias = eachDayOfInterval({ start: fechaInicio, end: fechaFin });
    
    return todosLosDias.filter(dia => {
      const fechaStr = format(dia, 'yyyy-MM-dd');
      const esFestivo = festivos.includes(fechaStr);
      const esDomingo = isSunday(dia);
      const esSabadoDescanso = this.esSabadoDescanso(dia, tipoDescanso);
      
      return !esFestivo && !esDomingo && !esSabadoDescanso;
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

    const semanasOrdenadas = Array.from(semanasAgrupadas.values()).sort((semanaA, semanaB) => {
        return semanaA[0].fechaObj - semanaB[0].fechaObj;
    });
    return semanasOrdenadas;
  }
}

/**
 * @class ServicioReporteTiempo
 * @description Contiene la lógica para consultar y calcular los tiempos registrados.
 */
class ServicioReporteTiempo {
  /**
   * Obtiene el reporte de horas de un día específico para un funcionario.
   * @param {string} funCod - Código del funcionario.
   * @param {Date} fecha - La fecha del reporte.
   * @returns {Promise<Object>} Un objeto con el detalle del reporte diario.
   */
  static async obtenerReporteDiario(funCod, fecha) {
    const fechaStr = format(fecha, 'yyyy-MM-dd');
    const esSabado = getDay(fecha) === 6;
    const horasRequeridas = esSabado ? 3 : 8.5;

    const resultado = await pool.request()
      .input('funCod', sql.VarChar, funCod)
      .input('fecha', sql.Date, fechaStr)
      .query(`
        SELECT 
          SUM(tap.TickActConsHor) AS TotalHoras,
          SUM(tap.TickActConsMin) AS TotalMinutos
        FROM 
          TicketActividad ta
          INNER JOIN TicketActividadProg tap ON ta.TickSec = tap.TickSec AND ta.TickActLinSec = tap.TickActLinSec
          INNER JOIN Ticket t ON ta.TickSec = t.TickSec
        WHERE 
          ta.FunCod = @funCod
          AND CONVERT(DATE, tap.TickFechaProg) = @fecha
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

    return {
      fecha: format(fecha, 'dd/MM/yyyy'), fechaObj: fecha,
      mensaje: mensaje, horas: horasRegistradas, minutos: minutosRegistrados,
      cumpleRequerimiento: cumpleRequerimiento, esSabado: esSabado
    };
  }

  /**
   * Calcula el resumen de horas para un conjunto de días (semanal o mensual).
   * @param {Array<Object>} diasSemana - Array de reportes diarios.
   * @returns {Object} Resumen con totales y estado de cumplimiento.
   */
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

    return {
      totalHoras: horasFormateadas, totalMinutos: minutosFormateados,
      horasRequeridas: `${horasRequeridasEntero}h ${minutosRequeridos.toString().padStart(2, '0')}m`,
      cumpleRequerimiento
    };
  }

  /**
   * Calcula el resumen mensual a partir de todos los reportes diarios del período.
   * @param {Array<Object>} diasReporte - Todos los reportes diarios del mes.
   * @param {number} sabadosExcluidos - Conteo de sábados no laborables.
   * @param {number} festivosExcluidos - Conteo de festivos.
   * @returns {Object} Objeto con el resumen mensual completo.
   */
  static calcularResumenMensual(diasReporte, sabadosExcluidos, festivosExcluidos) {
    const resumen = this.calcularResumenSemanal(diasReporte);
    return { ...resumen, sabadosExcluidos, festivosExcluidos };
  }
}

/**
 * @class ConstructorMensajesSlack
 * @description Se encarga de crear los bloques de mensajes de Slack, separando la vista de la lógica.
 */
class ConstructorMensajesSlack {
  /**
   * Construye el bloque de encabezado del reporte.
   * @returns {Array<Object>} Bloques de Slack.
   */
  static construirMensajeInicial(nombreUsuario, funCod, tipoDescanso, fechaInicio, fechaFin, sabadosExcluidos, festivosExcluidos) {
    return [
      { type: 'header', text: { type: 'plain_text', text: `📅 Reporte Mensual - ${format(fechaInicio, 'MMMM yyyy')}` } },
      { type: 'section', text: { type: 'mrkdwn', text: `*Usuario:* ${nombreUsuario} (${funCod})\n*Tipo Descanso:* ${tipoDescanso}\n*Período:* ${format(fechaInicio, 'dd/MM/yyyy')} - ${format(fechaFin, 'dd/MM/yyyy')}\n*Sábados excluidos:* ${sabadosExcluidos}\n*Festivos excluidos:* ${festivosExcluidos}` } },
      { type: 'divider' }
    ];
  }

  /**
   * Construye los bloques para mostrar el reporte de una semana.
   * @returns {Array<Object>} Bloques de Slack.
   */
  static construirMensajeSemanal(numeroSemana, diasSemana, fechaInicio, fechaFin, esUltimaSemana = false) {
    const resumenSemana = ServicioReporteTiempo.calcularResumenSemanal(diasSemana);
    
    const bloquesSemana = [
      { type: 'header', text: { type: 'plain_text', text: `📆 Semana ${numeroSemana} (${format(fechaInicio, 'dd/MM')} - ${format(fechaFin, 'dd/MM')})` } }
    ];

    const diasLaborales = diasSemana.filter(dia => !dia.esSabado);
    if (diasLaborales.length > 0) {
      bloquesSemana.push({ type: 'section', text: { type: 'mrkdwn', text: '*📝 Días laborales (L-V) - Requerido: 8h 30m*' } });
      for (let i = 0; i < diasLaborales.length; i += 2) {
        const campos = diasLaborales.slice(i, i + 2).map(dia => ({ type: 'mrkdwn', text: `${dia.cumpleRequerimiento ? '✅' : '⚠️'} *${dia.fecha}*\n${dia.mensaje}` }));
        while (campos.length < 2) campos.push({ type: 'mrkdwn', text: ' ' });
        bloquesSemana.push({ type: 'section', fields: campos });
      }
    }

    const sabados = diasSemana.filter(dia => dia.esSabado);
    if (sabados.length > 0) {
      bloquesSemana.push({ type: 'section', text: { type: 'mrkdwn', text: '*🛠️ Sábados laborables - Requerido: 3h*' } });
      sabados.forEach(dia => {
        bloquesSemana.push({ type: 'section', text: { type: 'mrkdwn', text: `${dia.cumpleRequerimiento ? '✅' : '⚠️'} *${dia.fecha}*\n${dia.mensaje}` } });
      });
    }

    if (!esUltimaSemana) {
      bloquesSemana.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `*📊 Total semana ${numeroSemana}:* ${resumenSemana.totalHoras}h ${resumenSemana.totalMinutos.toString().padStart(2, '0')}m (Requerido: ${resumenSemana.horasRequeridas}) ${resumenSemana.cumpleRequerimiento ? '✅' : '⚠️'}` }]
      });
    }

    bloquesSemana.push({ type: 'divider' });
    return bloquesSemana;
  }

  /**
   * Construye el bloque de resumen final del mes.
   * @param {Object} resumenMensual - Objeto con el resumen del mes.
   * @returns {Array<Object>} Bloques de Slack.
   */
  static construirResumenMensual(resumenMensual) {
    return [
      { type: 'header', text: { type: 'plain_text', text: '📊 Resumen Mensual' } },
      { type: 'section', fields: [
          { type: 'mrkdwn', text: `*Total registrado:* ${resumenMensual.totalHoras}h ${resumenMensual.totalMinutos.toString().padStart(2, '0')}m` },
          { type: 'mrkdwn', text: `*Requerido:* ${resumenMensual.horasRequeridas}` }
      ]},
      { type: 'section', fields: [{ type: 'mrkdwn', text: `*Estado:* ${resumenMensual.cumpleRequerimiento ? '✅ Cumple' : '⚠️ No cumple'}` }] },
      { type: 'section', fields: [
          { type: 'mrkdwn', text: `*Sábados excluidos:* ${resumenMensual.sabadosExcluidos}` },
          { type: 'mrkdwn', text: `*Festivos excluidos:* ${resumenMensual.festivosExcluidos}` }
      ]}
    ];
  }

  static construirMensajeError(error) {
    return [
      { type: 'section', text: { type: 'mrkdwn', text: '❌ *Error al generar el reporte mensual*' } },
      { type: 'section', text: { type: 'mrkdwn', text: `*Detalles:*\n${error.message}` } }
    ];
  }
}

/**
 * @class ComandoReporteMensual
 * @description Orquesta la lógica para el comando `crm-check-me`.
 * Genera un reporte personal del mes en curso hasta el día anterior.
 */
class ComandoReporteMensual {
  async execute(comando, say) {
    try {
      // 1. Obtener el ID del usuario que ejecutó el comando.
      const userId = comando.user_id;
      if (!userId) {
        throw new Error('No se pudo identificar al usuario (user_id no proporcionado)');
      }

      // 2. Obtener la información del usuario de Slack (nombre, email).
      const informacionUsuario = await ServicioUsuario.obtenerInformacionUsuario(userId);
      const nombreUsuario = informacionUsuario.real_name || 'Usuario';
      const emailUsuario = informacionUsuario.profile?.email || informacionUsuario.name;
      if (!emailUsuario) {
        throw new Error('No se pudo obtener el email del usuario');
      }

      // 3. Obtener datos del empleado de la BD (código, tipo de descanso).
      const { funCod, tipoDescanso } = await ServicioUsuario.obtenerDatosEmpleado(emailUsuario);

      // 4. Configurar el rango de fechas: desde el inicio del mes actual hasta ayer.
      const hoy = new Date();
      const primerDiaMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
      const ayer = subDays(hoy, 1);

      // 5. Obtener festivos y calcular días laborables.
      const festivos = ServicioFechas.obtenerFestivosColombia(hoy.getFullYear());
      const diasLaborables = ServicioFechas.obtenerDiasLaborables(primerDiaMes, ayer, tipoDescanso, festivos);

      // 6. Contar días no laborables para el resumen.
      const sabadosExcluidos = eachDayOfInterval({ start: primerDiaMes, end: ayer }).filter(dia => getDay(dia) === 6 && ServicioFechas.esSabadoDescanso(dia, tipoDescanso)).length;
      const festivosExcluidos = festivos.filter(f => {
        const fechaFestivo = new Date(f);
        return fechaFestivo >= primerDiaMes && fechaFestivo <= ayer;
      }).length;

      // 7. Generar el reporte diario para cada día laborable.
      const reportesDiarios = [];
      for (const dia of diasLaborables) {
        const reporte = await ServicioReporteTiempo.obtenerReporteDiario(funCod, dia);
        reportesDiarios.push(reporte);
      }

      // 8. Enviar mensaje inicial con el encabezado del reporte.
      await say({
        text: `Iniciando reporte mensual para ${nombreUsuario}`,
        blocks: ConstructorMensajesSlack.construirMensajeInicial(nombreUsuario, funCod, tipoDescanso, primerDiaMes, ayer, sabadosExcluidos, festivosExcluidos)
      });

      // 9. Agrupar por semanas y enviar el reporte de cada una.
      const semanas = ServicioFechas.agruparPorSemanas(reportesDiarios);
      
      if (semanas.length === 0) {
        await say({ text: 'No hay días laborables en el período solicitado', blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '*ℹ️ No hay días laborables en el período solicitado*' } }] });
        return;
      }
      
      for (const [indice, semana] of semanas.entries()) {
        const numeroSemana = indice + 1;
        const primeraFecha = semana[0].fechaObj;
        const ultimaFecha = semana[semana.length - 1].fechaObj;
        const esUltimaSemana = indice === semanas.length - 1;

        await say({
          text: `Reporte semana ${numeroSemana} para ${nombreUsuario}`,
          blocks: ConstructorMensajesSlack.construirMensajeSemanal(numeroSemana, semana, primeraFecha, ultimaFecha, esUltimaSemana)
        });
      }

      // 10. Calcular y enviar el resumen final del mes.
      const resumenMensual = ServicioReporteTiempo.calcularResumenMensual(reportesDiarios, sabadosExcluidos, festivosExcluidos);
      await say({
        text: `Resumen mensual para ${nombreUsuario}`,
        blocks: ConstructorMensajesSlack.construirResumenMensual(resumenMensual)
      });

    } catch (error) {
      console.error('🚨 Error en ComandoReporteMensual:', error);
      await say({
        text: `❌ Error al generar el reporte mensual`,
        blocks: ConstructorMensajesSlack.construirMensajeError(error)
      });
    }
  }
}

// Exportar la clase principal del comando.
module.exports = ComandoReporteMensual;