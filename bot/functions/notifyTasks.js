const { pool, poolConnect } = require('../../db/conection.js'); // Ajusta la ruta si es necesario
const { WebClient } = require('@slack/web-api');
const sql = require('mssql');
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

/**
 * Servicio para gestionar las notificaciones de tareas pendientes.
 * Contiene toda la lógica de base de datos y envío de mensajes.
 */
class ServicioNotificaciones {

  /**
   * Obtiene los códigos de funcionarios con tareas pendientes de notificar.
   * @returns {Promise<Array<number>>} Una lista de IDs de funcionarios (SubFunCodTar).
   */
  static async obtenerFuncionariosPorNotificar() {
    await poolConnect;
    try {
      const resultado = await pool.request().query(`
        SELECT DISTINCT SubFunCodTar 
        FROM Tareas 
        WHERE TarNot = 'N' OR TarNot IS NULL
      `);
      
      if (resultado.recordset.length === 0) {
        console.log('ℹ️ No hay tareas pendientes de notificar.');
        return [];
      }

      // Devolvemos un array plano de IDs: [10, 25, 30]
      return resultado.recordset.map(r => r.SubFunCodTar);

    } catch (error) {
      console.error('Error al obtener funcionarios con tareas pendientes:', error);
      throw new Error('No se pudieron consultar las tareas pendientes.');
    }
  }

  /**
   * Busca los emails (ID de Slack) de una lista de funcionarios.
   * @param {Array<number>} idsFuncionarios - Lista de FunCod.
   * @returns {Promise<Array<string>>} Una lista de emails/IDs de Slack.
   */
  static async obtenerEmailsDeFuncionarios(idsFuncionarios) {
    if (idsFuncionarios.length === 0) return [];
    
    await poolConnect;
    try {
      const request = pool.request();
      // Creamos los parámetros dinámicamente para evitar inyección SQL
      const params = idsFuncionarios.map((id, index) => `@id${index}`).join(',');
      idsFuncionarios.forEach((id, index) => {
        request.input(`id${index}`, sql.Int, id);
      });

      const resultado = await request.query(`
        SELECT FunDirEmail 
        FROM Funcionarios 
        WHERE FunCod IN (${params}) AND FunEst = 'A' AND FunDirEmail IS NOT NULL
      `);
      
      // Devolvemos un array plano de emails, filtrando los nulos por si acaso
      return resultado.recordset.map(r => r.FunDirEmail).filter(Boolean);

    } catch (error) {
      console.error('Error al obtener emails de funcionarios:', error);
      throw new Error('No se pudieron obtener los datos de los funcionarios.');
    }
  }

  /**
   * Marca las tareas como notificadas para una lista de funcionarios.
   * @param {Array<number>} idsFuncionarios - Lista de FunCod a quienes se les notificó.
   */
  static async marcarTareasComoNotificadas(idsFuncionarios) {
    if (idsFuncionarios.length === 0) return;
    
    await poolConnect;
    try {
        const request = pool.request();
        const params = idsFuncionarios.map((id, index) => `@id${index}`).join(',');
        idsFuncionarios.forEach((id, index) => {
            request.input(`id${index}`, sql.Int, id);
        });

      const resultado = await request.query(`
        UPDATE Tareas 
        SET TarNot = 'S' 
        WHERE SubFunCodTar IN (${params}) AND (TarNot = 'N' OR TarNot IS NULL)
      `);
      
      console.log(`✅ ${resultado.rowsAffected[0]} tareas actualizadas a 'S'.`);

    } catch (error) {
      console.error('Error al actualizar el estado de las tareas:', error);
      // No lanzamos error para no detener el flujo si los mensajes ya se enviaron.
      // Pero sí es importante registrarlo.
    }
  }
}

/**
 * Comando para orquestar el proceso de notificación de tareas.
 */
class ComandoNotificarTareas {
  /**
   * Ejecuta el flujo completo de notificación.
   */
  async execute() {
    // 1. Obtener los IDs de funcionarios con tareas pendientes
    const idsFuncionarios = await ServicioNotificaciones.obtenerFuncionariosPorNotificar();
    if (idsFuncionarios.length === 0) {
      return 'No hay usuarios para notificar.';
    }

    // 2. Obtener los emails/IDs de Slack de esos funcionarios
    const emailsSlack = await ServicioNotificaciones.obtenerEmailsDeFuncionarios(idsFuncionarios);
    if (emailsSlack.length === 0) {
        console.log('⚠️ Se encontraron tareas pendientes, pero no se hallaron los emails de Slack correspondientes.');
        // Aun así, marcamos las tareas para no volver a procesarlas
        await ServicioNotificaciones.marcarTareasComoNotificadas(idsFuncionarios);
        return 'No se encontraron usuarios de Slack válidos para los funcionarios con tareas pendientes.';
    }
    
    // 3. Enviar mensaje a cada usuario
    const mensaje = "👋 ¡Hola! Tienes una tarea nueva pendiente en el CRM. Por favor, recarga la página y revísala en la sección de 'Notificaciones' o en la pantalla 'wptareas'.";
    
    const promesasEnvio = emailsSlack.map(email => {
      return slackClient.chat.postMessage({
        channel: email, // Enviar a DM usando el ID de usuario (que es el email en tu caso)
        text: mensaje
      }).catch(err => console.error(`Error enviando mensaje a ${email}: ${err.data.error}`));
    });

    await Promise.all(promesasEnvio);
    console.log(`🚀 Mensajes enviados a ${emailsSlack.length} usuarios.`);

    // 4. Actualizar la base de datos para no volver a notificar
    await ServicioNotificaciones.marcarTareasComoNotificadas(idsFuncionarios);

    return `Proceso de notificación finalizado para ${idsFuncionarios.length} funcionarios.`;
  }
}

module.exports = ComandoNotificarTareas;