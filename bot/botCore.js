const { App } = require('@slack/bolt');
const CheckAllCommand = require('./commands/checkAll');
const CheckMeCommand = require('./commands/checkMe');
const CheckAllPastCommand = require('./commands/checkAllPast');
const CheckMePastCommand = require('./commands/checkMePast');
const CheckCommands = require('./commands/checkCommands');
const CheckMyProfile = require('./commands/checkMyProfile');
require('dotenv').config();

const bot = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: false,
  port: 3000 
});

// Mapeo de comandos
const commandHandlers = {
  'info': () => new CheckCommands(),
  'ayuda': () => new CheckCommands(),
  'unicheck': () => new CheckMyProfile(),
  'crm-check-me': () => new CheckMeCommand(),
  'crm-check-me-past': () => new CheckMePastCommand(),
  'crm-check-all-admin': () => new CheckAllCommand(),
  'crm-check-all-admin-past': () => new CheckAllPastCommand()
};

// Manejo de mensajes directos con threading
bot.event('message', async ({ event, say }) => {
  if (event.channel_type === 'im' && !event.bot_id && !event.subtype) {
    const commandText = event.text.toLowerCase().trim();
    const handlerFactory = commandHandlers[commandText];
    
    const replyInThread = async (message) => {
      await say({
        ...message,
        thread_ts: event.ts,
        reply_broadcast: false
      });
    };

    if (handlerFactory) {
      try {
        const handler = handlerFactory();
        
        // Creamos el objeto comando que espera execute(comando, say)
        const comando = {
          user_id: event.user,  // ID del usuario (lo más importante)
          user: event.user,     // Para compatibilidad
          text: event.text,
          ts: event.ts,
          event: event          // Pasamos el evento completo por si acaso
        };

        await handler.execute(comando, replyInThread);
      } catch (error) {
        console.error('Error ejecutando comando:', error);
        await replyInThread({
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: '❌ *Error al procesar el comando*'
              }
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `\`\`\`${error.message}\`\`\``
              }
            }
          ]
        });
      }
    } else {
      await replyInThread({
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "❌ *Comando no reconocido*"
            }
          },
          {
            type: "divider"
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "Comandos disponibles:\n\n" +
                    "• `info`/`ayuda` - Muestra ayuda\n" +
                    "• `unicheck` - Tu perfil\n" +
                    "• `crm-check-me` - Tus registros\n" +
                    "• `crm-check-me-past` - Registros mes pasado"
            }
          }
        ]
      });
    }
  }
});

(async () => {
  await bot.start();
  console.log(`⚡ Bot listo para mensajes directos en puerto 3000`);
})();

module.exports = bot;