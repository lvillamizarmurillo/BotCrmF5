const { pool, poolConnect } = require('../../db/conection.js');
const { WebClient } = require('@slack/web-api');
const sql = require('mssql');
const { format, subDays, eachDayOfInterval, getDay, isSunday, startOfWeek, endOfWeek, addDays, subMonths, startOfMonth, endOfMonth } = require('date-fns');
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

// Lista de funcionarios autorizados para ejecutar este comando
const FUNCIONARIOS_AUTORIZADOS = ['LUDWINGV', 'KARLAC', '10', '11', '8'];

/**
 * Servicio para manejar operaciones relacionadas con usuarios
 */
class ServicioUsuario {
  /**
   * Obtiene información del usuario desde Slack usando su username
   * @param {string} username - Nombre de usuario en Slack (name)
   * @returns {Promise<Object|null>} Información del usuario o null si no se encuentra
   */
  static async obtenerInformacionUsuarioPorUsername(username) {
    try {
      // Primero obtenemos todos los usuarios
      const respuesta = await slackClient.users.list();
      
      if (!respuesta.ok || !respuesta.members) {
        throw new Error('No se pudo obtener la lista de usuarios de Slack');
      }

      // Buscamos el usuario por su nombre (name)
      const usuario = respuesta.members.find(member => 
        member.name === username.toLowerCase() // Normalizamos a minúsculas para comparar
      );

      return usuario || null;
    } catch (error) {
      console.error(`Error al obtener info del usuario con username ${username}:`, error);
      return null;
    }
  }

  /**
   * Obtiene todos los funcionarios activos con username registrado
   * @returns {Promise<Array<Object>>} Array de objetos con FunCod, TipoDescanso y username
   */
  static async obtenerTodosFuncionariosActivos() {
    await poolConnect;
    const resultado = await pool.request()
      .query(`
        SELECT FunCod, TipoDescanso, FunDirEmail 
        FROM Funcionarios 
        WHERE FunEst = 'A' 
        AND FunDirEmail IS NOT NULL
      `);

    if (resultado.recordset.length === 0) {
      throw new Error('No se encontraron funcionarios activos con username registrado');
    }

    // Filtrar y mapear los resultados
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
        username: funcionario.FunDirEmail // Asumimos que FunDirEmail contiene el username de Slack
      }));
  }

  /**
   * Verifica si un funcionario está autorizado para ejecutar el comando
   * @param {string} funCod - Código del funcionario
   * @returns {boolean} True si está autorizado, false si no
   */
  static tienePermisosAdministrador(funCod) {
    return FUNCIONARIOS_AUTORIZADOS.includes(funCod);
  }
}

/**
 * Servicio para manejar operaciones con fechas
 */
class ServicioFechas {
  static obtenerFestivosColombia(año) {
    return [
      `${año}-01-01`, `${año}-01-06`, `${año}-03-19`, `${año}-05-01`,
      `${año}-06-29`, `${año}-07-20`, `${año}-08-07`, `${año}-08-15`,
      `${año}-10-12`, `${año}-11-01`, `${año}-11-11`, `${año}-12-08`,
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
    const semanaDelMes = Math.ceil(fecha.getDate() / 7);
    return (tipoDescanso === 1 && semanaDelMes % 2 === 1) || (tipoDescanso === 2 && semanaDelMes % 2 === 0);
  }

  static agruparPorSemanas(dias) {
    if (dias.length === 0) {
      return [];
    }
    
    // Un Map para agrupar los días. La clave será el string de la fecha de inicio de semana.
    const semanasAgrupadas = new Map();

    dias.forEach(dia => {
      // Obtenemos el Lunes de la semana a la que pertenece el día. { weekStartsOn: 1 } define Lunes como inicio.
      const inicioDeSemana = startOfWeek(dia.fechaObj, { weekStartsOn: 1 });
      const inicioDeSemanaStr = format(inicioDeSemana, 'yyyy-MM-dd');

      // Si no tenemos una entrada para esta semana, la creamos.
      if (!semanasAgrupadas.has(inicioDeSemanaStr)) {
        semanasAgrupadas.set(inicioDeSemanaStr, []);
      }
      
      // Añadimos el día al array de su semana correspondiente.
      semanasAgrupadas.get(inicioDeSemanaStr).push(dia);
    });

    // Convertimos el Map en un array de semanas y lo ordenamos para asegurar el orden cronológico.
    const semanasOrdenadas = Array.from(semanasAgrupadas.values()).sort((semanaA, semanaB) => {
        return semanaA[0].fechaObj - semanaB[0].fechaObj;
    });
    return semanasOrdenadas;
  }
}

/**
 * Servicio para generar reportes de tiempo
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
    let horasRegistradas = 0;
    let minutosRegistrados = 0;
    let mensaje = '';
    let cumpleRequerimiento = false;
    let faltante = '';

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
      fecha: format(fecha, 'dd/MM/yyyy'),
      fechaObj: fecha,
      mensaje: mensaje,
      horas: horasRegistradas,
      minutos: minutosRegistrados,
      cumpleRequerimiento: cumpleRequerimiento,
      esSabado: esSabado
    };
  }

  static calcularResumenSemanal(diasSemana) {
    const totalHoras = diasSemana.reduce((sum, dia) => sum + dia.horas, 0);
    const totalMinutos = diasSemana.reduce((sum, dia) => sum + dia.minutos, 0);
    const horasFormateadas = totalHoras + Math.floor(totalMinutos / 60);
    const minutosFormateados = totalMinutos % 60;

    const diasLaborales = diasSemana.filter(dia => !dia.esSabado).length;
    const sabadosLaborables = diasSemana.filter(dia => dia.esSabado).length;
    
    // Convertir horas requeridas a formato hh:mm (8.5 horas = 8:30)
    const horasRequeridasLaborales = diasLaborales * 8.5;
    const horasRequeridasSabados = sabadosLaborables * 3;
    const totalHorasRequeridas = horasRequeridasLaborales + horasRequeridasSabados;
    
    // Separar en horas y minutos
    const horasRequeridasEntero = Math.floor(totalHorasRequeridas);
    const minutosRequeridos = Math.round((totalHorasRequeridas - horasRequeridasEntero) * 60);
    
    const totalHorasDecimal = horasFormateadas + (minutosFormateados / 60);
    const cumpleRequerimiento = totalHorasDecimal >= totalHorasRequeridas;

    return {
      totalHoras: horasFormateadas,
      totalMinutos: minutosFormateados,
      horasRequeridas: `${horasRequeridasEntero}h ${minutosRequeridos.toString().padStart(2, '0')}m`,
      cumpleRequerimiento: cumpleRequerimiento
    };
  }

  static calcularResumenMensual(diasReporte, sabadosExcluidos, festivosExcluidos) {
    const resumenSemanal = this.calcularResumenSemanal(diasReporte);
    return {
      ...resumenSemanal,
      sabadosExcluidos,
      festivosExcluidos
    };
  }
}

/**
 * Constructor de mensajes para Slack
 */
class ConstructorMensajesSlack {
  static construirMensajeCompleto(nombreUsuario, funCod, tipoDescanso, fechaInicio, fechaFin, sabadosExcluidos, festivosExcluidos, semanas, resumenMensual) {
    const bloques = [];
    
    // 1. Encabezado e información inicial
    bloques.push({
      type: 'header',
      text: {
        type: 'plain_text',
        text: `📅 Reporte Mensual - ${format(fechaInicio, 'MMMM yyyy')} (Mes Anterior)`
      }
    });
    
    bloques.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Usuario:* ${nombreUsuario} (${funCod})\n*Tipo Descanso:* ${tipoDescanso}\n*Período:* ${format(fechaInicio, 'dd/MM/yyyy')} - ${format(fechaFin, 'dd/MM/yyyy')}\n*Sábados excluidos:* ${sabadosExcluidos}\n*Festivos excluidos:* ${festivosExcluidos}`
      }
    });
    
    bloques.push({ type: 'divider' });
    
    // 2. Secciones por semana
    for (const [indice, semana] of semanas.entries()) {
      const numeroSemana = indice + 1;
      const primeraFecha = semana[0].fechaObj;
      const ultimaFecha = semana[semana.length - 1].fechaObj;
      const resumenSemana = ServicioReporteTiempo.calcularResumenSemanal(semana);
      const esUltimaSemana = indice === semanas.length - 1;
      
      // Encabezado semana
      bloques.push({
        type: 'header',
        text: {
          type: 'plain_text',
          text: `📆 Semana ${numeroSemana} (${format(primeraFecha, 'dd/MM')} - ${format(ultimaFecha, 'dd/MM')})`
        }
      });
      
      // Días laborales
      const diasLaborales = semana.filter(dia => !dia.esSabado);
      if (diasLaborales.length > 0) {
        bloques.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*📝 Días laborales (L-V) - Requerido: 8h 30m*'
          }
        });

        for (let i = 0; i < diasLaborales.length; i += 2) {
          const campos = diasLaborales.slice(i, i + 2).map(dia => ({
            type: 'mrkdwn',
            text: `${dia.cumpleRequerimiento ? '✅' : '⚠️'} *${dia.fecha}*\n${dia.mensaje}`
          }));
          
          while (campos.length < 2) campos.push({ type: 'mrkdwn', text: ' ' });
          bloques.push({ type: 'section', fields: campos });
        }
      }
      
      // Sábados
      const sabados = semana.filter(dia => dia.esSabado);
      if (sabados.length > 0) {
        bloques.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*🛠️ Sábados laborables - Requerido: 3h*'
          }
        });

        sabados.forEach(dia => {
          bloques.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${dia.cumpleRequerimiento ? '✅' : '⚠️'} *${dia.fecha}*\n${dia.mensaje}`
            }
          });
        });
      }
      
      // Resumen semana - Solo si no es la última semana
      if (!esUltimaSemana) {
        bloques.push({
          type: 'context',
          elements: [{
            type: 'mrkdwn',
            text: `*📊 Total semana ${numeroSemana}:* ${resumenSemana.totalHoras}h ${resumenSemana.totalMinutos.toString().padStart(2, '0')}m (Requerido: ${resumenSemana.horasRequeridas}) ${resumenSemana.cumpleRequerimiento ? '✅' : '⚠️'}`
          }]
        });
      }
      
      bloques.push({ type: 'divider' });
    }
    
    // 3. Resumen mensual
    bloques.push({
      type: 'header',
      text: {
        type: 'plain_text',
        text: '📊 Resumen Mensual'
      }
    });
    
    bloques.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*TOTAL MENSUAL:* ${resumenMensual.totalHoras}h ${resumenMensual.totalMinutos.toString().padStart(2, '0')}m ${resumenMensual.cumpleRequerimiento ? '✅' : '⚠️'}\n*Requerido:* ${resumenMensual.horasRequeridas}\n*Sábados excluidos:* ${resumenMensual.sabadosExcluidos}\n*Festivos excluidos:* ${resumenMensual.festivosExcluidos}`
      }
    });
    
    return bloques;
  }

  static construirMensajeError(error) {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '❌ *Error al generar el reporte mensual*'
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Detalles:*\n${error.message}`
        }
      }
    ];
  }

  static construirMensajeSinPermisos() {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '⛔ *Acceso denegado*'
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'No tienes permisos para ejecutar este comando de administrador.\n\nPor favor, contacta al servicio técnico si necesitas acceso.'
        }
      }
    ];
  }
}

/**
 * Comando para generar reportes mensuales masivos
 */
class ComandoReporteMensualMasivoPast {
  /**
   * Ejecuta el comando para generar reportes masivos
   * @param {Object} comando - Objeto con el comando de Slack
   * @param {Function} say - Función para enviar mensajes a Slack
   */
  async execute(comando, say) {
    try {
      const userId = comando.user_id;

      // 0. Verificar permisos del usuario que ejecuta el comando
      // Obtener información del usuario de Slack
      const usuarioSlack = await slackClient.users.info({ user: userId });
      if (!usuarioSlack.ok || !usuarioSlack.user) {
        throw new Error('No se pudo obtener información del usuario de Slack');
      }
      
      // Buscar el FunCod del usuario en la base de datos usando su username de Slack (FunDirEmail)
      await poolConnect;
      const resultado = await pool.request()
        .input('username', sql.VarChar, usuarioSlack.user.name)
        .query(`
          SELECT FunCod FROM Funcionarios 
          WHERE FunEst = 'A' AND FunDirEmail = @username
        `);

      if (resultado.recordset.length === 0) {
        return await say({
          blocks: ConstructorMensajesSlack.construirMensajeSinPermisos()
        });
      }

      const funCodUsuario = resultado.recordset[0].FunCod;
      
      // Verificar si el usuario está autorizado
      if (!FUNCIONARIOS_AUTORIZADOS.includes(funCodUsuario)) {
        return await say({
          blocks: ConstructorMensajesSlack.construirMensajeSinPermisos()
        });
      }

      // 1. Obtener todos los funcionarios activos
      const funcionarios = await ServicioUsuario.obtenerTodosFuncionariosActivos();

      // 2. Configurar fechas del reporte (mes anterior completo)
      const hoy = new Date();
      const primerDiaMesAnterior = startOfMonth(subMonths(hoy, 1));
      const ultimoDiaMesAnterior = endOfMonth(subMonths(hoy, 1));
      const festivos = ServicioFechas.obtenerFestivosColombia(primerDiaMesAnterior.getFullYear());

      // 3. Enviar confirmación de inicio
      await say({
        text: `Iniciando envío masivo de reportes a ${funcionarios.length} funcionarios`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `⏳ *Iniciando envío masivo de reportes mensuales*\nSe enviarán reportes del mes anterior (${format(primerDiaMesAnterior, 'MMMM yyyy')}) a ${funcionarios.length} funcionarios activos`
            }
          }
        ]
      });

      // Contadores para el resumen final
      let usuariosProcesados = 0;
      let usuariosConPendientes = 0;
      let usuariosAlDia = 0;

      // 4. Procesar cada funcionario
      for (const funcionario of funcionarios) {
        try {
          // 4.1 Obtener información del usuario en Slack por username
          const userInfo = await ServicioUsuario.obtenerInformacionUsuarioPorUsername(funcionario.username);
          if (!userInfo) {
            console.warn(`⚠️ No se encontró usuario en Slack con username: ${funcionario.username}`);
            continue;
          }

          const nombreUsuario = userInfo.real_name || userInfo.name || 'Usuario';
          const userId = userInfo.id;

          // 4.2 Obtener días laborables del mes anterior completo
          const diasLaborables = ServicioFechas.obtenerDiasLaborables(
            primerDiaMesAnterior, 
            ultimoDiaMesAnterior, 
            funcionario.tipoDescanso, 
            festivos
          );

          // 4.3 Contar días excluidos (sábados y festivos del mes anterior)
          const sabadosExcluidos = eachDayOfInterval({
            start: primerDiaMesAnterior,
            end: ultimoDiaMesAnterior
          }).filter(dia => 
            getDay(dia) === 6 && ServicioFechas.esSabadoDescanso(dia, funcionario.tipoDescanso)
          ).length;

          const festivosExcluidos = festivos.filter(f => {
            const fechaFestivo = new Date(f);
            return fechaFestivo >= primerDiaMesAnterior && fechaFestivo <= ultimoDiaMesAnterior;
          }).length;

          // 4.4 Generar reporte diario para todos los días laborables del mes anterior
          const reportesDiarios = [];
          let tienePendientes = false;
          
          for (const dia of diasLaborables) {
            const reporte = await ServicioReporteTiempo.obtenerReporteDiario(funcionario.funCod, dia);
            reportesDiarios.push(reporte);
            
            // Verificar si este día tiene pendientes
            if (!reporte.cumpleRequerimiento) {
              tienePendientes = true;
            }
          }

          // 4.5 Si el usuario está al día (sin pendientes), saltar al siguiente
          if (!tienePendientes) {
            console.log(`✅ Usuario ${nombreUsuario} (${funcionario.funCod}) está al día, no se enviará reporte`);
            usuariosAlDia++;
            continue;
          }

          usuariosConPendientes++;

          // 4.6 Dividir en semanas
          const semanas = ServicioFechas.agruparPorSemanas(reportesDiarios);
          
          // 4.7 Calcular resumen mensual
          const resumenMensual = ServicioReporteTiempo.calcularResumenMensual(
            reportesDiarios, 
            sabadosExcluidos, 
            festivosExcluidos
          );

          // 4.8 Construir y enviar mensaje completo
          const bloquesMensaje = ConstructorMensajesSlack.construirMensajeCompleto(
            nombreUsuario,
            funcionario.funCod,
            funcionario.tipoDescanso,
            primerDiaMesAnterior,
            ultimoDiaMesAnterior,
            sabadosExcluidos,
            festivosExcluidos,
            semanas,
            resumenMensual
          );

          await slackClient.chat.postMessage({
            channel: userId,
            text: `Reporte mensual completo para ${nombreUsuario} (${format(primerDiaMesAnterior, 'MMMM yyyy')})`,
            blocks: bloquesMensaje
          });

          usuariosProcesados++;

        } catch (error) {
          console.error(`🚨 Error procesando funcionario ${funcionario.funCod}:`, error);
          // Continuar con el siguiente funcionario aunque falle uno
        }
      }

      // 5. Enviar resumen de ejecución
      await say({
        text: 'Envío masivo de reportes completado',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✅ *Envío masivo de reportes completado*`
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Total funcionarios:* ${funcionarios.length}\n*Procesados:* ${usuariosProcesados}\n*Al día:* ${usuariosAlDia}\n*Con pendientes:* ${usuariosConPendientes}`
            }
          },
          {
            type: 'context',
            elements: [{
              type: 'mrkdwn',
              text: `Solo se enviaron reportes a usuarios con horas pendientes por registrar del mes ${format(primerDiaMesAnterior, 'MMMM yyyy')}`
            }]
          }
        ]
      });

    } catch (error) {
      console.error('🚨 Error en comando masivo:', error);
      await say({
        text: '❌ Error al ejecutar el comando masivo',
        blocks: ConstructorMensajesSlack.construirMensajeError(error)
      });
    }
  }
}

module.exports = ComandoReporteMensualMasivoPast;