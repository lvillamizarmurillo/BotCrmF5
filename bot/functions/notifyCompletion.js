const { pool, poolConnect } = require('../../db/conection.js');
const { WebClient } = require('@slack/web-api');
const sql = require('mssql');
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

/**
 * Servicio para obtener datos de la tarea finalizada y sus involucrados.
 */
class ServicioNotificacionFinalizacion {

  /**
   * Obtiene los detalles clave de una tarea y los datos de los funcionarios relacionados.
   * @param {number} tarSec - El ID de la tarea (TarSec).
   * @returns {Promise<Object>} Un objeto con el email del asignador y el nombre del asignado.
   */
  static async obtenerDetallesTarea(tarSec) {
    await poolConnect;
    try {
      const resultado = await pool.request()
        .input('tarSec', sql.Int, tarSec)
        .query(`
          SELECT 
              Asignador.FunDirEmail,
              Asignado.FunNom
          FROM 
              Tareas T
          LEFT JOIN 
              Funcionarios Asignador ON T.FunCod = Asignador.FunCod
          LEFT JOIN 
              Funcionarios Asignado ON T.SubFunCodTar = Asignado.FunCod
          WHERE 
              T.TarSec = @tarSec
        `);

      if (resultado.recordset.length === 0) {
        throw new Error(`No se encontró la tarea con TarSec: ${tarSec}`);
      }
      
      const { FunDirEmail, FunNom } = resultado.recordset[0];

      if (!FunDirEmail || !FunNom) {
          throw new Error(`Datos incompletos para la tarea ${tarSec}. Falta email del asignador o nombre del asignado.`);
      }

      return { emailNotificar: FunDirEmail, nombreCompletador: FunNom };

    } catch (error) {
      console.error('Error al obtener los detalles de la tarea:', error);
      throw error; // Propagamos el error para que sea capturado por el endpoint.
    }
  }
}

/**
 * Comando para orquestar el proceso de notificación de tarea finalizada.
 */
class ComandoNotificarFinalizacion {
  constructor(tarSec) {
    if (!tarSec) {
      throw new Error('El ID de la tarea (TarSec) es requerido.');
    }
    this.tarSec = tarSec;
  }

  /**
   * Ejecuta el flujo completo de notificación.
   */
  async execute() {
    // 1. Obtener los detalles de la BD
    const { emailNotificar, nombreCompletador } = await ServicioNotificacionFinalizacion.obtenerDetallesTarea(this.tarSec);

    // 2. Construir y enviar el mensaje
    const mensaje = `👋 ¡Buenas noticias! El usuario *${nombreCompletador}* ya finalizó la tarea que le asignaste.`;
    
    try {
      await slackClient.chat.postMessage({
        channel: emailNotificar, // ID de usuario (email) a notificar
        text: mensaje
      });
      console.log(`🚀 Notificación de tarea finalizada enviada a ${emailNotificar}.`);
      return `Notificación enviada exitosamente a ${emailNotificar}.`;
    } catch (err) {
      console.error(`Error enviando mensaje de finalización a ${emailNotificar}:`, err.data ? err.data.error : err.message);
      throw new Error(`No se pudo enviar el mensaje por Slack a ${emailNotificar}.`);
    }
  }
}

module.exports = ComandoNotificarFinalizacion;