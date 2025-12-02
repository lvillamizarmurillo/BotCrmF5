// Importaciones de módulos necesarios.
const { pool, poolConnect } = require('../../db/conection.js'); // Conexión a la base de datos.
const { WebClient } = require('@slack/web-api'); // Cliente de la API de Slack.
const sql = require('mssql'); // Driver de SQL Server.

// Inicialización del cliente de Slack.
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

/**
 * @class ServicioPerfilUsuario
 * @description Encapsula la lógica para obtener la información del perfil de un usuario
 * tanto de Slack como de la base de datos interna.
 */
class ServicioPerfilUsuario {
  /**
   * Obtiene información básica de un usuario desde la API de Slack usando su ID.
   * @param {string} userId - El ID del usuario en Slack.
   * @returns {Promise<Object>} Un objeto con el nombre y el email del usuario.
   */
  static async obtenerInfoSlack(userId) {
    try {
      const respuesta = await slackClient.users.info({ user: userId });
      return {
        nombre: respuesta.user.real_name || 'Usuario',
        emailSlack: respuesta.user.profile.email || respuesta.user.name
      };
    } catch (error) {
      console.error('Error obteniendo info de Slack:', error);
      // Devuelve un objeto por defecto para evitar que la aplicación falle.
      return { nombre: 'Usuario', emailSlack: 'usuario_desconocido' };
    }
  }

  /**
   * Obtiene la información detallada de un funcionario desde la base de datos.
   * La búsqueda se realiza usando el email del usuario, que debe coincidir con `FunDirEmail`.
   * @param {string} email - El email del funcionario.
   * @returns {Promise<Object>} Un objeto con la información completa del funcionario.
   */
  static async obtenerInfoFuncionario(email) {
    await poolConnect;
    try {
      const resultado = await pool.request()
        .input('email', sql.VarChar(254), email)
        .query(`
          SELECT 
            f.FunCod, f.FunNom, f.FunUsu, f.FunPass, f.FunDirEmail,
            f.FunCc, ta.TrabAreNom, c.CarNom
          FROM 
            Funcionarios f
            LEFT JOIN TrabajoArea ta ON f.TrabAreId = ta.TrabAreId
            LEFT JOIN Cargo c ON f.CarId = c.CarId
          WHERE 
            f.FunDirEmail = @email
            AND f.FunEst = 'A'
        `);

      if (resultado.recordset.length === 0) {
        throw new Error('No se encontró un funcionario activo con ese email');
      }

      return resultado.recordset[0];
    } catch (error) {
      console.error('Error obteniendo info de funcionario:', error);
      throw error; // Propaga el error para ser manejado por el llamador.
    }
  }
}

/**
 * @class ConstructorMensajePerfil
 * @description Clase responsable de construir los bloques de mensajes de Slack
 * para mostrar el perfil del usuario, separando la presentación de la lógica.
 */
class ConstructorMensajePerfil {
  /**
   * Construye el mensaje de perfil completo con la información obtenida.
   * @param {Object} infoSlack - Información obtenida de Slack.
   * @param {Object} infoFuncionario - Información obtenida de la base de datos.
   * @returns {Array<Object>} Un array de bloques de mensaje de Slack.
   */
  static construir(infoSlack, infoFuncionario) {
    return [
      {
        type: 'header',
        text: { type: 'plain_text', text: '📋 Perfil del Funcionario' }
      },
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🆔 *Código:* ${infoFuncionario.FunCod || 'No disponible'}` + 
                ' '.repeat(30) + 
                `👤 *Nombre:* ${infoFuncionario.FunNom || infoSlack.nombre}`
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `📧 *Email Slack:* ${infoFuncionario.FunDirEmail || infoSlack.emailSlack}` + 
                ' '.repeat(16) + 
                `🪪 *Cédula:* ${infoFuncionario.FunCc || 'Pendiente'}`
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🏢 *Área:* ${infoFuncionario.TrabAreNom || 'No asignada'}` + 
                ' '.repeat(37) + 
                `💼 *Cargo:* ${infoFuncionario.CarNom || 'No asignado'}`
        }
      },
      { type: 'divider' },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '*🔑 Credenciales CRM*' }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `👤 *Usuario:* \`${infoFuncionario.FunUsu || 'No disponible'}\`` + 
                ' '.repeat(29) + 
                `🔒 *Contraseña:* \`${infoFuncionario.FunPass || 'No disponible'}\``
        }
      }
    ];
  }

  /**
   * Construye un mensaje de error estandarizado.
   * @param {Error} error - El objeto de error capturado.
   * @returns {Array<Object>} Bloques de mensaje de error para Slack.
   */
  static construirError(error) {
    return [
      {
        type: 'header',
        text: { type: 'plain_text', text: '❌ Error al obtener perfil' }
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*Detalles del error:*\n${error.message}` }
      },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: '🛠️ Consulta intentada sobre las tablas relacionadas: Funcionarios, TrabajoArea y Cargo' }
        ]
      }
    ];
  }
}

/**
 * @class ComandoPerfil
 * @description Clase principal que orquesta la ejecución del comando `unicheck`.
 */
class ComandoPerfil {
  /**
   * Ejecuta la lógica para obtener y mostrar el perfil del usuario.
   * @param {Object} comando - El objeto del comando de Slack.
   * @param {Function} say - La función para enviar mensajes de vuelta a Slack.
   */
  async execute(comando, say) {
    try {
      // 1. Obtener información básica del usuario desde Slack (nombre, email).
      const infoSlack = await ServicioPerfilUsuario.obtenerInfoSlack(comando.user_id);
      
      // 2. Usar el email para obtener la información detallada del funcionario desde la BD.
      const infoFuncionario = await ServicioPerfilUsuario.obtenerInfoFuncionario(infoSlack.emailSlack);
      
      // 3. Construir y enviar el mensaje de perfil completo.
      await say({
        text: `Perfil de ${infoFuncionario.FunNom || infoSlack.nombre}`,
        blocks: ConstructorMensajePerfil.construir(infoSlack, infoFuncionario)
      });

    } catch (error) {
      // En caso de error, construir y enviar un mensaje de error.
      console.error('Error en comando perfil:', error);
      await say({
        text: 'Error al obtener el perfil',
        blocks: ConstructorMensajePerfil.construirError(error)
      });
    }
  }
}

// Exportar la clase principal para ser usada en `botCore.js`.
module.exports = ComandoPerfil;