// Importar el cliente de la API de Slack.
const { WebClient } = require('@slack/web-api');
// Inicializar el cliente de Slack. Aunque no se usa directamente en esta clase,
// es una buena práctica mantenerlo por si se añaden funcionalidades futuras.
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

/**
 * @class ComandoAyuda
 * @description Clase que maneja el comando de ayuda (`info` o `ayuda`).
 * Su única responsabilidad es mostrar una lista formateada de los comandos disponibles.
 */
class ComandoAyuda {
  /**
   * Ejecuta la lógica para enviar el mensaje de ayuda.
   * @param {Object} comando - El objeto del comando de Slack, que contiene información como el `thread_ts`.
   * @param {Function} say - La función proporcionada por Bolt para enviar mensajes al canal.
   */
  async execute(comando, say) {
    try {
      // Envía un mensaje formateado con bloques de Slack.
      await say({
        text: '📚 Comandos disponibles del bot de reportes CRM', // Texto de fallback para notificaciones.
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: '📚 Ayuda de Comandos CRM'
            }
          },
          { type: 'divider' },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*Estos son los comandos disponibles:*'
            }
          },
          // Fila de comandos 1: unicheck y crm-check-me
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: ':mag: `unicheck`' + ' '.repeat(52) + ':bar_chart: `crm-check-me`\n' +
                    '*Muestra tu información personal*' + ' '.repeat(18) + '*Registros de este mes*'
            }
          },
          { type: 'divider' },
          // Fila de comandos 2: crm-check-me-past e info
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: ':rewind: `crm-check-me-past`' + ' '.repeat(37) + ':information_source: `info`\n' +
                    '*Registros mes anterior*' + ' '.repeat(36) + '*Muestra esta lista*'
            }
          },
          { type: 'divider' },
          // Notas de contexto y ayuda adicional.
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: 'ℹ️ Ejecuta estos comandos en mensajes directos al bot'
              }
            ]
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: '🔧 ¿Necesitas ayuda? Contacta al equipo de soporte técnico'
              }
            ]
          }
        ],
        // Asegura que la respuesta se envíe en el hilo de la conversación original.
        thread_ts: comando.thread_ts || comando.ts,
        reply_broadcast: false // Evita que la respuesta se muestre en el canal principal.
      });
    } catch (error) {
      // En caso de error, lo registra en la consola y envía un mensaje de error al usuario.
      console.error('Error al enviar mensaje de ayuda:', error);
      await say({
        text: '❌ Error al mostrar la ayuda',
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: '❌ Error en el sistema' }
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: '*No se pudo cargar la lista de comandos*' }
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: '```' + error.message + '```' }
          },
          {
            type: 'context',
            elements: [
              { type: 'mrkdwn', text: '🛠️ Por favor inténtalo nuevamente o reporta este error' }
            ]
          }
        ],
        thread_ts: comando.thread_ts || comando.ts,
        reply_broadcast: false
      });
    }
  }
}

// Exportar la clase para que pueda ser instanciada en `botCore.js`.
module.exports = ComandoAyuda;