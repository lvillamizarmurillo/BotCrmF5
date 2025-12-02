const { pool, poolConnect } = require('../../db/conection.js');
const { WebClient } = require('@slack/web-api');
const sql = require('mssql');
const { format, subDays, eachDayOfInterval, getDay, isSunday, startOfWeek, endOfWeek, addDays, getWeek } = require('date-fns');
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

class ServicioUsuario {
  static async obtenerInformacionUsuario(userId) {
    try {
      if (!userId) {
        throw new Error('No se proporcionó un ID de usuario');
      }
      
      const respuesta = await slackClient.users.info({ user: userId });
      return respuesta.user;
    } catch (error) {
      console.error('Error al obtener info del usuario:', error);
      return { 
        real_name: 'Usuario', 
        name: 'usuario_desconocido',
        profile: { email: 'usuario@desconocido.com' }
      };
    }
  }

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
    // No procesar si no es sábado.
    if (getDay(fecha) !== 6) return false;

    // Se obtiene el número de la semana del año. 
    // { weekStartsOn: 1 } asegura que la semana empiece en Lunes, para consistencia.
    const semanaDelAño = getWeek(fecha, { weekStartsOn: 1 });
    
    // El tipo 1 descansa en semanas IMPARES del año.
    // El tipo 2 descansa en semanas PARES del año.
    // Este método es robusto y no se "invierte" entre meses.
    return (tipoDescanso === 1 && semanaDelAño % 2 === 1) || (tipoDescanso === 2 && semanaDelAño % 2 === 0);
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

class ServicioReporteTiempo {
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
      cumpleRequerimiento
    };
  }

  static calcularResumenMensual(diasReporte, sabadosExcluidos, festivosExcluidos) {
    const { totalHoras, totalMinutos, horasRequeridas, cumpleRequerimiento } = 
      this.calcularResumenSemanal(diasReporte);
    
    return {
      totalHoras,
      totalMinutos,
      horasRequeridas,
      cumpleRequerimiento,
      sabadosExcluidos,
      festivosExcluidos
    };
  }
}

class ConstructorMensajesSlack {
  static construirMensajeInicial(nombreUsuario, funCod, tipoDescanso, fechaInicio, fechaFin, sabadosExcluidos, festivosExcluidos) {
    return [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `📅 Reporte Mensual - ${format(fechaInicio, 'MMMM yyyy')}`
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Usuario:* ${nombreUsuario} (${funCod})\n*Tipo Descanso:* ${tipoDescanso}\n*Período:* ${format(fechaInicio, 'dd/MM/yyyy')} - ${format(fechaFin, 'dd/MM/yyyy')}\n*Sábados excluidos:* ${sabadosExcluidos}\n*Festivos excluidos:* ${festivosExcluidos}`
        }
      },
      {
        type: 'divider'
      }
    ];
  }

  static construirMensajeSemanal(numeroSemana, diasSemana, fechaInicio, fechaFin, esUltimaSemana = false) {
    const { totalHoras, totalMinutos, horasRequeridas, cumpleRequerimiento } = 
      ServicioReporteTiempo.calcularResumenSemanal(diasSemana);
    
    const bloquesSemana = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `📆 Semana ${numeroSemana} (${format(fechaInicio, 'dd/MM')} - ${format(fechaFin, 'dd/MM')})`
        }
      }
    ];

    // Días laborales (L-V)
    const diasLaborales = diasSemana.filter(dia => !dia.esSabado);
    if (diasLaborales.length > 0) {
      bloquesSemana.push({
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
        
        while (campos.length < 2) {
          campos.push({
            type: 'mrkdwn',
            text: ' '
          });
        }

        bloquesSemana.push({
          type: 'section',
          fields: campos
        });
      }
    }

    // Sábados laborables
    const sabados = diasSemana.filter(dia => dia.esSabado);
    if (sabados.length > 0) {
      bloquesSemana.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*🛠️ Sábados laborables - Requerido: 3h*'
        }
      });

      sabados.forEach(dia => {
        bloquesSemana.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${dia.cumpleRequerimiento ? '✅' : '⚠️'} *${dia.fecha}*\n${dia.mensaje}`
          }
        });
      });
    }

    // Resumen semanal - Solo si no es la última semana
    if (!esUltimaSemana) {
      bloquesSemana.push({
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: `*📊 Total semana ${numeroSemana}:* ${totalHoras}h ${totalMinutos.toString().padStart(2, '0')}m (Requerido: ${horasRequeridas}) ${cumpleRequerimiento ? '✅' : '⚠️'}`
        }]
      });
    }

    bloquesSemana.push({
      type: 'divider'
    });

    return bloquesSemana;
  }

  static construirResumenMensual(resumenMensual) {
    return [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '📊 Resumen Mensual'
        }
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Total registrado:* ${resumenMensual.totalHoras}h ${resumenMensual.totalMinutos.toString().padStart(2, '0')}m`
          },
          {
            type: 'mrkdwn',
            text: `*Requerido:* ${resumenMensual.horasRequeridas}`
          }
        ]
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Estado:* ${resumenMensual.cumpleRequerimiento ? '✅ Cumple' : '⚠️ No cumple'}`
          }
        ]
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Sábados excluidos:* ${resumenMensual.sabadosExcluidos}`
          },
          {
            type: 'mrkdwn',
            text: `*Festivos excluidos:* ${resumenMensual.festivosExcluidos}`
          }
        ]
      }
    ];
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
}

class ComandoReporteMensual {
  async execute(comando, say) {
    try {
      // 1. Obtener ID de usuario del objeto comando
      const userId = comando.user_id;

      if (!userId) {
        throw new Error('No se pudo identificar al usuario (user_id no proporcionado)');
      }

      // 2. Obtener información del usuario
      const informacionUsuario = await ServicioUsuario.obtenerInformacionUsuario(userId);
      const nombreUsuario = informacionUsuario.real_name || 'Usuario';
      
      // 3. Obtener email del usuario (usando profile.email si existe)
      const emailUsuario = informacionUsuario.profile?.email || informacionUsuario.name;
      if (!emailUsuario) {
        throw new Error('No se pudo obtener el email del usuario');
      }

      // 4. Obtener datos del empleado
      const { funCod, tipoDescanso } = await ServicioUsuario.obtenerDatosEmpleado(emailUsuario);

      // 5. Configurar fechas del reporte
      const hoy = new Date();
      const primerDiaMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
      const ayer = subDays(hoy, 1);

      // 6. Obtener días festivos
      const festivos = ServicioFechas.obtenerFestivosColombia(hoy.getFullYear());

      // 7. Obtener días laborables del mes
      const diasLaborables = ServicioFechas.obtenerDiasLaborables(
        primerDiaMes, 
        ayer, 
        tipoDescanso, 
        festivos
      );

      // 8. Contar días excluidos
      const sabadosExcluidos = eachDayOfInterval({
        start: primerDiaMes,
        end: ayer
      }).filter(dia => 
        getDay(dia) === 6 && ServicioFechas.esSabadoDescanso(dia, tipoDescanso)
      ).length;

      const festivosExcluidos = festivos.filter(f => {
        const fechaFestivo = new Date(f);
        return fechaFestivo >= primerDiaMes && fechaFestivo <= ayer;
      }).length;

      // 9. Generar reporte diario
      const reportesDiarios = [];
      for (const dia of diasLaborables) {
        const reporte = await ServicioReporteTiempo.obtenerReporteDiario(funCod, dia);
        reportesDiarios.push(reporte);
      }

      // 10. Enviar mensaje inicial
      await say({
        text: `Iniciando reporte mensual para ${nombreUsuario}`,
        blocks: ConstructorMensajesSlack.construirMensajeInicial(
          nombreUsuario, 
          funCod, 
          tipoDescanso, 
          primerDiaMes, 
          ayer,
          sabadosExcluidos,
          festivosExcluidos
        )
      });

      // 11. Dividir en semanas y enviar reportes
      const semanas = ServicioFechas.agruparPorSemanas(reportesDiarios, ayer);
      
      if (semanas.length === 0) {
        await say({
          text: 'No hay días laborables en el período solicitado',
          blocks: [{
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*ℹ️ No hay días laborables en el período solicitado*'
            }
          }]
        });
        return;
      }
      
      for (const [indice, semana] of semanas.entries()) {
        const numeroSemana = indice + 1;
        const primeraFecha = semana[0].fechaObj;
        const ultimaFecha = semana[semana.length - 1].fechaObj;
        const esUltimaSemana = indice === semanas.length - 1;

        await say({
          text: `Reporte semana ${numeroSemana} para ${nombreUsuario}`,
          blocks: ConstructorMensajesSlack.construirMensajeSemanal(
            numeroSemana, 
            semana, 
            primeraFecha, 
            ultimaFecha,
            esUltimaSemana
          )
        });
      }

      // 12. Enviar resumen mensual
      const resumenMensual = ServicioReporteTiempo.calcularResumenMensual(
        reportesDiarios, 
        sabadosExcluidos, 
        festivosExcluidos
      );

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

module.exports = ComandoReporteMensual;