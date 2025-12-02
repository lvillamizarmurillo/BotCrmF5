// Importar dependencias necesarias.
const { pool, poolConnect } = require('../../db/conection.js'); // Conexión a la base de datos.
const { WebClient } = require('@slack/web-api'); // Cliente de la API de Slack.
const sql = require('mssql'); // Driver de SQL Server.

// Inicializar el cliente de la API de Slack con el token del bot.
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

/**
 * @class ServicioSlack
 * @description Encapsula la lógica para interactuar con la API de Slack,
 * específicamente para la gestión de usuarios.
 */
class ServicioSlack {
    /**
     * Busca el ID de un usuario en Slack a partir de su nombre de usuario (username).
     * @param {string} username - El nombre de usuario a buscar (ej. 'lvillamizarmurillo').
     * @returns {Promise<string|null>} El ID del usuario de Slack (ej. 'U123ABC456') o `null` si no se encuentra.
     */
    static async obtenerIdUsuarioPorUsername(username) {
        if (!username) {
            console.warn('Se intentó buscar un usuario de Slack sin proporcionar un username.');
            return null;
        }
        try {
            // 1. Obtener la lista completa de usuarios del workspace.
            // Slack no ofrece un endpoint directo para buscar por `username`, por lo que este es el método estándar.
            const respuesta = await slackClient.users.list();
            
            if (respuesta.ok && respuesta.members) {
                // 2. Buscar en la lista de miembros el que coincida con el `username` (insensible a mayúsculas).
                const usuarioEncontrado = respuesta.members.find(
                    miembro => miembro.name === username.toLowerCase()
                );

                if (usuarioEncontrado) {
                    // 3. Si se encuentra, devolver su ID.
                    return usuarioEncontrado.id;
                }
            }
            // Si no se encuentra el usuario o la respuesta de la API falla.
            console.log(`No se encontró un usuario en Slack con el username: ${username}`);
            return null;
        } catch (error) {
            console.error(`Error al listar o buscar usuarios de Slack por username (${username}):`, error);
            return null;
        }
    }
}

/**
 * @class ServicioNotificaciones
 * @description Contiene la lógica para realizar consultas a la base de datos
 * relacionadas con las tareas y los funcionarios.
 */
class ServicioNotificaciones {
    /**
     * Obtiene los detalles de una tarea específica por su ID.
     * @param {number} tarSec - El ID secuencial de la tarea.
     * @returns {Promise<Object|null>} Un objeto con los datos de la tarea o `null` si no se encuentra.
     */
    static async obtenerTareaPorId(tarSec) {
        await poolConnect;
        try {
            const resultado = await pool.request()
                .input('TarSec', sql.Int, tarSec)
                .query('SELECT TarSec, TarDes, FunCod, SubFunCodTar FROM Tareas WHERE TarSec = @TarSec');
            if (resultado.recordset.length === 0) {
                console.warn(`⚠️ No se encontró la tarea con TarSec: ${tarSec}`);
                return null;
            }
            return resultado.recordset[0];
        } catch (error) {
            console.error('Error al obtener la tarea por ID:', error);
            throw new Error('No se pudo consultar la tarea específica.');
        }
    }

    /**
     * Obtiene el `username` de Slack (almacenado en `FunDirEmail`) de un funcionario a partir de su código.
     * @param {string} funCod - El código del funcionario.
     * @returns {Promise<string|null>} El `username` del funcionario o `null` si no se encuentra.
     */
    static async obtenerUsernameDeFuncionario(funCod) {
        if (!funCod) return null;
        await poolConnect;
        try {
            const resultado = await pool.request()
                .input('FunCod', sql.VarChar, funCod)
                .query(`SELECT FunDirEmail FROM Funcionarios WHERE FunCod = @FunCod AND FunEst = 'A' AND FunDirEmail IS NOT NULL`);
            return resultado.recordset.length > 0 ? resultado.recordset[0].FunDirEmail : null;
        } catch (error) {
            console.error('Error al obtener username del funcionario:', error);
            throw new Error('No se pudo obtener el username del funcionario.');
        }
    }

    /**
     * Obtiene el nombre completo de un funcionario a partir de su código.
     * @param {string} funCod - El código del funcionario.
     * @returns {Promise<string>} El nombre del funcionario o 'Un usuario' si no se encuentra.
     */
    static async obtenerNombreDeFuncionario(funCod) {
        if (!funCod) return 'Un usuario';
        await poolConnect;
        try {
            const resultado = await pool.request()
                .input('FunCod', sql.VarChar, funCod)
                .query('SELECT FunNom FROM Funcionarios WHERE FunCod = @FunCod');
            return resultado.recordset.length > 0 ? resultado.recordset[0].FunNom.trim() : 'Un usuario';
        } catch (error) {
            console.error(`Error al obtener el nombre del funcionario ${funCod}:`, error);
            return 'Un usuario';
        }
    }
}

/**
 * @class NotifyTasksFunction
 * @description Clase principal que orquesta la lógica de notificación.
 * Es invocada desde el endpoint de `botCore.js` cuando GeneXus realiza una llamada.
 */
class NotifyTasksFunction {
    /**
     * Ejecuta el proceso de notificación.
     * @param {string} vaDirigidoA - Define el tipo de notificación ('NotificarAsignado' o 'NotificarCreador').
     * @param {number} tarSec - El ID de la tarea a notificar.
     * @returns {Promise<string>} Un mensaje indicando el resultado de la operación.
     */
    async execute(vaDirigidoA, tarSec) {
        // 1. Obtener la información de la tarea.
        const tarea = await ServicioNotificaciones.obtenerTareaPorId(tarSec);
        if (!tarea) {
            throw new Error(`La tarea con ID ${tarSec} no existe.`);
        }

        let targetFunCod = null;
        let mensaje = "";

        // 2. Determinar el destinatario y el contenido del mensaje según el tipo de notificación.
        if (vaDirigidoA === 'NotificarAsignado') {
            // Notificación para el usuario a quien se le asignó la tarea.
            targetFunCod = tarea.SubFunCodTar; // El destinatario es el funcionario asignado.
            const nombreCreador = await ServicioNotificaciones.obtenerNombreDeFuncionario(tarea.FunCod);
            mensaje = `👋 ¡Hola! *${nombreCreador}* te asignó la tarea con ID *${tarSec}*. Por favor, revísala en el sistema.`;
        } else if (vaDirigidoA === 'NotificarCreador') {
            // Notificación para el usuario que creó la tarea.
            targetFunCod = tarea.FunCod; // El destinatario es el funcionario creador.
            const nombreAsignado = await ServicioNotificaciones.obtenerNombreDeFuncionario(tarea.SubFunCodTar);
            mensaje = `👍 ¡Buenas noticias! *${nombreAsignado}* finalizó la tarea con ID *${tarSec}*. Ya puedes verificarla.`;
        } else {
            throw new Error(`El parámetro 'vaDirigidoA' ("${vaDirigidoA}") no es válido.`);
        }

        if (!targetFunCod) {
            return `La tarea ${tarSec} no tiene un destinatario válido para la acción '${vaDirigidoA}'.`;
        }
        
        // 3. Obtener el `username` de Slack del funcionario destinatario desde la base de datos.
        const usernameSlack = await ServicioNotificaciones.obtenerUsernameDeFuncionario(targetFunCod);
        if (!usernameSlack) {
            console.warn(`⚠️ No se encontró un username de Slack en la BD para el funcionario ${targetFunCod}.`);
            return `No se encontró el username de Slack para el funcionario ${targetFunCod}.`;
        }

        // 4. Usar el `username` para encontrar el ID de usuario de Slack.
        const slackUserId = await ServicioSlack.obtenerIdUsuarioPorUsername(usernameSlack);
        if (!slackUserId) {
            console.warn(`⚠️ No se encontró un usuario en Slack con el username ${usernameSlack} (del Funcionario: ${targetFunCod}).`);
            return `No se encontró el usuario de Slack correspondiente al funcionario ${targetFunCod}.`;
        }
        
        // 5. Enviar el mensaje directo al ID de usuario de Slack encontrado.
        try {
            await slackClient.chat.postMessage({
                channel: slackUserId, // El ID del canal de DM es el mismo que el ID de usuario.
                text: mensaje
            });
        } catch(err) {
            console.error(`Error al enviar mensaje a ${slackUserId}: ${err.data ? err.data.error : err.message}`);
            throw new Error(`No se pudo enviar el mensaje de Slack al usuario ${slackUserId}.`);
        }
        
        return `Notificación para la tarea ${tarSec} enviada correctamente a ${targetFunCod}.`;
    }
}

// Exportar la clase para que pueda ser instanciada en `botCore.js`.
module.exports = NotifyTasksFunction;