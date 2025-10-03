const { pool, poolConnect } = require('../../db/conection.js');
const { WebClient } = require('@slack/web-api');
const sql = require('mssql');

const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

/**
 * 🛠️ SERVICIO SLACK ACTUALIZADO
 * Ahora busca por nombre de usuario en lugar de email.
 */
class ServicioSlack {
    /**
     * Busca un usuario en Slack por su nombre de usuario (ej. 'lvillamizarmurillo').
     * @param {string} username - El nombre de usuario a buscar.
     * @returns {Promise<string|null>} El ID del usuario de Slack (ej: 'U123ABC456') o null si no se encuentra.
     */
    static async obtenerIdUsuarioPorUsername(username) {
        if (!username) {
            console.warn('Se intentó buscar un usuario de Slack sin proporcionar un username.');
            return null;
        }
        try {
            // 1. Obtenemos la lista de TODOS los usuarios del workspace.
            // Slack no tiene un método directo para buscar por username, esta es la forma estándar.
            const respuesta = await slackClient.users.list();
            
            if (respuesta.ok && respuesta.members) {
                // 2. Buscamos en la lista el miembro cuyo 'name' coincida.
                const usuarioEncontrado = respuesta.members.find(
                    miembro => miembro.name === username.toLowerCase()
                );

                if (usuarioEncontrado) {
                    // 3. Si lo encontramos, devolvemos su ID.
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
 * Servicio para gestionar la lógica de base de datos (SIN CAMBIOS).
 */
class ServicioNotificaciones {
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

    static async obtenerUsernameDeFuncionario(funCod) { // Cambiado nombre para claridad
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
 * Orquesta la notificación de UNA tarea específica (LÓGICA ACTUALIZADA).
 */
class NotifyTasksFunction {
    async execute(vaDirigidoA, tarSec) {
        const tarea = await ServicioNotificaciones.obtenerTareaPorId(tarSec);
        if (!tarea) {
            throw new Error(`La tarea con ID ${tarSec} no existe.`);
        }

        let targetFunCod = null;
        let mensaje = "";

        if (vaDirigidoA === 'NotificarAsignado') {
            targetFunCod = tarea.SubFunCodTar;
            const nombreCreador = await ServicioNotificaciones.obtenerNombreDeFuncionario(tarea.FunCod);
            mensaje = `👋 ¡Hola! *${nombreCreador}* te asignó la tarea con ID *${tarSec}*. Por favor, revísala en el sistema.`;
        } else if (vaDirigidoA === 'NotificarCreador') {
            targetFunCod = tarea.FunCod;
            const nombreAsignado = await ServicioNotificaciones.obtenerNombreDeFuncionario(tarea.SubFunCodTar);
            mensaje = `👍 ¡Buenas noticias! *${nombreAsignado}* finalizó la tarea con ID *${tarSec}*. Ya puedes verificarla.`;
        } else {
            throw new Error(`El parámetro 'vaDirigidoA' ("${vaDirigidoA}") no es válido.`);
        }

        if (!targetFunCod) {
            return `La tarea ${tarSec} no tiene un destinatario válido para la acción '${vaDirigidoA}'.`;
        }
        
        // CAMBIO 1: Obtenemos el username de la BD. Le cambié el nombre a la función y variable para que sea más claro.
        const usernameSlack = await ServicioNotificaciones.obtenerUsernameDeFuncionario(targetFunCod);
        if (!usernameSlack) {
            console.warn(`⚠️ No se encontró un username de Slack en la BD para el funcionario ${targetFunCod}.`);
            return `No se encontró el username de Slack para el funcionario ${targetFunCod}.`;
        }

        // CAMBIO 2: Usamos el nuevo método para buscar por username.
        const slackUserId = await ServicioSlack.obtenerIdUsuarioPorUsername(usernameSlack);
        if (!slackUserId) {
            console.warn(`⚠️ No se encontró un usuario en Slack con el username ${usernameSlack} (del Funcionario: ${targetFunCod}).`);
            return `No se encontró el usuario de Slack correspondiente al funcionario ${targetFunCod}.`;
        }
        
        // CAMBIO 3: El envío del mensaje ahora funcionará porque `slackUserId` es el ID correcto.
        try {
            await slackClient.chat.postMessage({
                channel: slackUserId,
                text: mensaje
            });
        } catch(err) {
            console.error(`Error al enviar mensaje a ${slackUserId}: ${err.data ? err.data.error : err.message}`);
            throw new Error(`No se pudo enviar el mensaje de Slack al usuario ${slackUserId}.`);
        }
        
        return `Notificación para la tarea ${tarSec} enviada correctamente a ${targetFunCod}.`;
    }
}

module.exports = NotifyTasksFunction;