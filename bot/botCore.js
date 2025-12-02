// Importar las dependencias necesarias de @slack/bolt para la creación de la app y el receptor de eventos.
const { App, ExpressReceiver } = require('@slack/bolt');

// Importar los manejadores de comandos y funciones específicas del bot.
const CheckAllCommand = require('./commands/checkAll');
const CheckMeCommand = require('./commands/checkMe');
const CheckAllPastCommand = require('./commands/checkAllPast');
const CheckMePastCommand = require('./commands/checkMePast');
const CheckCommands = require('./commands/checkCommands');
const CheckMyProfile = require('./commands/checkMyProfile');
const NotifyTasksFunction = require('./functions/notifyTasks');

// Cargar variables de entorno desde el archivo .env para la configuración segura.
require('dotenv').config();

/**
 * @constant {ExpressReceiver} receiver
 * @description PASO 1: Se crea una instancia de ExpressReceiver.
 * Esto permite que la aplicación de Bolt se integre con un servidor Express.
 * Es crucial para exponer endpoints HTTP personalizados, como el que usará GeneXus.
 * Se configura con el `signingSecret` para verificar que las solicitudes provienen de Slack.
 */
const receiver = new ExpressReceiver({ 
  signingSecret: process.env.SLACK_SIGNING_SECRET 
});

/**
 * @constant {App} bot
 * @description PASO 2: Se configura la instancia principal del bot de Slack.
 * Se le pasa el `token` del bot para la autenticación con la API de Slack
 * y el `receiver` creado anteriormente para manejar las solicitudes HTTP.
 */
const bot = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver // Se pasa el receiver configurado.
});

/**
 * @description PASO 3: Se configura un endpoint HTTP POST personalizado usando el `receiver`.
 * Este endpoint está diseñado para ser llamado por un sistema externo (como GeneXus).
 * La ruta es `/api/notificar-tareas/:vaDirigidoA/:TarSec`, donde los parámetros son dinámicos.
 * 
 * @param {string} :vaDirigidoA - Indica el tipo de notificación ('NotificarAsignado' o 'NotificarCreador').
 * @param {string} :TarSec - El identificador único de la tarea.
 */
receiver.app.post('/api/notificar-tareas/:vaDirigidoA/:TarSec', async (req, res) => {
    // Extraer los parámetros de la URL de la solicitud.
    const { vaDirigidoA, TarSec } = req.params;

    try {
        // Se crea una instancia del manejador de la lógica de notificación.
        const handler = new NotifyTasksFunction(); 
        // Se ejecuta la lógica principal de notificación con los parámetros recibidos.
        const resultado = await handler.execute(vaDirigidoA, TarSec); 

        // Se envía una respuesta HTTP 200 (OK) al sistema externo (GeneXus),
        // indicando que la solicitud fue procesada correctamente.
        res.status(200).json({
            status: 'ok',
            message: resultado
        });

    } catch (error) {
        // Si ocurre un error durante el proceso, se captura y se loguea en la consola.
        console.error('❌ Error en el proceso de notificación de tarea:', error);
        // Se envía una respuesta HTTP 500 (Error Interno del Servidor) al sistema externo.
        res.status(500).json({
            status: 'error',
            message: error.message || 'Ocurrió un error interno al procesar la notificación.',
        });
    }
});

/**
 * @constant {Object.<string, function>} commandHandlers
 * @description Mapeo de los textos de los comandos a las clases que los manejan.
 * Esto permite una gestión centralizada y escalable de los comandos.
 * Cuando un usuario escribe un comando, se busca en este objeto para encontrar
 * la clase constructora (`handlerFactory`) correspondiente.
 */
const commandHandlers = {
  'info': () => new CheckCommands(),
  'ayuda': () => new CheckCommands(),
  'unicheck': () => new CheckMyProfile(),
  'crm-check-me': () => new CheckMeCommand(),
  'crm-check-me-past': () => new CheckMePastCommand(),
  'crm-check-all-admin': () => new CheckAllCommand(),
  'crm-check-all-admin-past': () => new CheckAllPastCommand()
};

/**
 * @description Manejador de eventos para mensajes directos (`im`).
 * Escucha cada vez que un usuario envía un mensaje al bot.
 * Se asegura de no procesar mensajes de otros bots (`!event.bot_id`) o subtipos de eventos.
 */
bot.event('message', async ({ event, say }) => {
  // Solo procesar mensajes en canales de tipo 'im' (mensajes directos),
  // que no sean de un bot y no sean subtipos de eventos (como ediciones o eliminaciones).
  if (event.channel_type === 'im' && !event.bot_id && !event.subtype) {
    // Normalizar el texto del comando a minúsculas y sin espacios extra.
    const commandText = event.text.toLowerCase().trim();
    // Buscar el constructor del manejador de comandos en el mapa.
    const handlerFactory = commandHandlers[commandText];
    
    /**
     * @function replyInThread
     * @description Función de utilidad para responder en un hilo al mensaje original.
     * Esto mantiene las conversaciones organizadas.
     * @param {Object} message - El objeto de mensaje a enviar.
     */
    const replyInThread = async (message) => {
      await say({
        ...message,
        thread_ts: event.ts, // Identificador del mensaje original para crear o unirse al hilo.
        reply_broadcast: false // Evita que la respuesta se envíe también al canal principal.
      });
    };

    // Si se encontró un manejador para el comando...
    if (handlerFactory) {
      try {
        // Se crea una instancia del manejador.
        const handler = handlerFactory();
        
        // Se crea un objeto `comando` que simula la estructura que esperan los manejadores.
        // Esto es útil para mantener la compatibilidad y pasar la información necesaria.
        const comando = {
          user_id: event.user,  // El ID del usuario que envió el mensaje.
          user: event.user,     // Para compatibilidad con otras partes del código.
          text: event.text,
          ts: event.ts,
          event: event          // Se pasa el evento completo por si se necesita más contexto.
        };

        // Se ejecuta el método `execute` del manejador, pasando el objeto `comando` y la función de respuesta.
        await handler.execute(comando, replyInThread);
      } catch (error) {
        // Si hay un error al ejecutar el comando, se loguea y se notifica al usuario.
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
      // Si no se reconoce el comando, se envía un mensaje de ayuda al usuario.
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

/**
 * @description Función autoejecutable asíncrona para iniciar el bot.
 * El bot se inicia y comienza a escuchar en el puerto especificado en las variables de entorno,
 * o en el puerto 3000 por defecto.
 */
(async () => {
  await bot.start(process.env.PORT || 3000);
  console.log(`⚡ Bot listo para mensajes directos en puerto ${process.env.PORT || 3000}`);
})();

// Se exporta la instancia del bot para poder ser utilizada en otros módulos si fuera necesario.
module.exports = bot;