const { App, ExpressReceiver } = require('@slack/bolt');
const CheckAllCommand = require('./commands/checkAll');
const CheckMeCommand = require('./commands/checkMe');
const CheckAllPastCommand = require('./commands/checkAllPast');
const CheckMePastCommand = require('./commands/checkMePast');
const CheckCommands = require('./commands/checkCommands');
const CheckMyProfile = require('./commands/checkMyProfile');
const NotifyTasksFunction = require('./functions/notifyTasks');
const NotifyCompletionFunction = require('./functions/notifyCompletion');
require('dotenv').config();

// PASO 1: Crear instancia del ExpressReceiver
const receiver = new ExpressReceiver({ 
  signingSecret: process.env.SLACK_SIGNING_SECRET 
});

// PASO 2: Configurar el bot con el receiver
const bot = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver // Pasamos el receiver configurado
});

// PASO 3: Configurar el endpoint para GeneXus usando receiver.app
receiver.app.post('/api/notificar-tareas', async (req, res) => {
  console.log('✅ Petición recibida desde GeneXus para notificar tareas.');
  
  try {
    const handler = new NotifyTasksFunction();
    const resultado = await handler.execute(); // Ejecutamos la lógica de notificación

    // Respondemos a GeneXus que todo salió bien
    res.status(200).json({ 
        status: 'ok', 
        message: resultado 
    });

  } catch (error) {
    console.error('❌ Error en el proceso de notificación de tareas:', error);
    // Informamos a GeneXus del error
    res.status(500).json({ 
        status: 'error', 
        message: 'Ocurrió un error interno al procesar las notificaciones.',
        detail: error.message
    });
  }
});

receiver.app.post('/api/notificar-finalizacion/:tarSec', async (req, res) => {
  const { tarSec } = req.params; // Capturamos el TarSec desde la URL
  console.log(`✅ Petición recibida desde GeneXus para notificar finalización de tarea: ${tarSec}.`);

  try {
    // Pasamos el tarSec al constructor de nuestra nueva clase
    const handler = new NotifyCompletionFunction(tarSec);
    const resultado = await handler.execute();

    res.status(200).json({ 
        status: 'ok', 
        message: resultado 
    });

  } catch (error) {
    console.error(`❌ Error en el proceso de notificación para Tarea ${tarSec}:`, error);
    res.status(500).json({ 
        status: 'error', 
        message: 'Ocurrió un error interno al procesar la notificación.',
        detail: error.message
    });
  }
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
  // Ahora el bot se inicia usando el puerto que le indiques
  await bot.start(process.env.PORT || 3000);
  console.log(`⚡ Bot listo para mensajes directos en puerto ${process.env.PORT || 3000}`);
})();

module.exports = bot;