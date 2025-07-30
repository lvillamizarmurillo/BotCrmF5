const { WebClient } = require('@slack/web-api');
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

class ComandoAyuda {
  async execute(comando, say) {
    try {
      await say({
        text: '📚 Comandos disponibles del bot de reportes CRM',
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: '📚 Ayuda de Comandos CRM'
            }
          },
          {
            type: 'divider'
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*Estos son los comandos disponibles:*'
            }
          },
          // Primera fila de comandos
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: ':mag: `unicheck`' + ' '.repeat(52) + ':bar_chart: `crm-check-me`\n' +
                    '*Muestra tu información personal*' + ' '.repeat(18) + '*Registros de este mes*'
            }
          },
          // Separador visual
          {
            type: 'divider'
          },
          // Segunda fila de comandos
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: ':rewind: `crm-check-me-past`' + ' '.repeat(37) + ':information_source: `info`\n' +
                    '*Registros mes anterior*' + ' '.repeat(36) + '*Muestra esta lista*'
            }
          },
          {
            type: 'divider'
          },
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
        thread_ts: comando.thread_ts || comando.ts,
        reply_broadcast: false
      });
    } catch (error) {
      console.error('Error al enviar mensaje de ayuda:', error);
      await say({
        text: '❌ Error al mostrar la ayuda',
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: '❌ Error en el sistema'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*No se pudo cargar la lista de comandos*'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '```' + error.message + '```'
            }
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: '🛠️ Por favor inténtalo nuevamente o reporta este error'
              }
            ]
          }
        ],
        thread_ts: comando.thread_ts || comando.ts,
        reply_broadcast: false
      });
    }
  }
}

module.exports = ComandoAyuda;