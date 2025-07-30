const { pool, poolConnect } = require('../../db/conection.js');
const { WebClient } = require('@slack/web-api');
const sql = require('mssql');
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

/**
 * Servicio para obtener información del perfil del usuario
 */
class ServicioPerfilUsuario {
  /**
   * Obtiene información del usuario desde Slack
   * @param {string} userId - ID del usuario en Slack
   * @returns {Promise<Object>} Información básica del usuario
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
      return { nombre: 'Usuario', emailSlack: 'usuario_desconocido' };
    }
  }

  /**
   * Obtiene información detallada del funcionario desde la base de datos
   * @param {string} email - Email del usuario (usado para buscar en FunDirEmail)
   * @returns {Promise<Object>} Información completa del funcionario
   */
  static async obtenerInfoFuncionario(email) {
    await poolConnect;
    try {
      const resultado = await pool.request()
        .input('email', sql.VarChar(254), email)
        .query(`
          SELECT 
            f.FunCod, 
            f.FunNom, 
            f.FunUsu, 
            f.FunPass, 
            f.FunDirEmail,
            f.FunCc,
            ta.TrabAreNom,
            c.CarNom
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
      throw error;
    }
  }
}

/**
 * Constructor de mensajes para el perfil de usuario
 */
class ConstructorMensajePerfil {
  /**
   * Construye el mensaje completo del perfil
   * @param {Object} infoSlack - Información de Slack
   * @param {Object} infoFuncionario - Información de la base de datos
   * @returns {Array} Bloques de mensaje para Slack
   */
  static construir(infoSlack, infoFuncionario) {
    return [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '📋 Perfil del Funcionario'
        }
      },
      {
        type: 'divider'
      },
      // Sección 1: Código y Nombre
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🆔 *Código:* ${infoFuncionario.FunCod || 'No disponible'}` + 
                ' '.repeat(30) + 
                `👤 *Nombre:* ${infoFuncionario.FunNom || infoSlack.nombre}`
        }
      },
      // Sección 2: Email y Cédula
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `📧 *Email Slack:* ${infoFuncionario.FunDirEmail || infoSlack.emailSlack}` + 
                ' '.repeat(16) + 
                `🪪 *Cédula:* ${infoFuncionario.FunCc || 'Pendiente'}`
        }
      },
      // Sección 3: Área y Cargo
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🏢 *Área:* ${infoFuncionario.TrabAreNom || 'No asignada'}` + 
                ' '.repeat(37) + 
                `💼 *Cargo:* ${infoFuncionario.CarNom || 'No asignado'}`
        }
      },
      {
        type: 'divider'
      },
      // Sección 4: Credenciales
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*🔑 Credenciales CRM*'
        }
      },
      // Sección 5: Usuario y Contraseña
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
   * Construye mensaje de error
   * @param {Error} error - Objeto de error
   * @returns {Array} Bloques de mensaje de error para Slack
   */
  static construirError(error) {
    return [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '❌ Error al obtener perfil'
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Detalles del error:*\n${error.message}`
        }
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '🛠️ Consulta intentada sobre las tablas relacionadas: Funcionarios, TrabajoArea y Cargo'
          }
        ]
      }
    ];
  }
}

/**
 * Comando para mostrar el perfil del usuario
 */
class ComandoPerfil {
  /**
   * Ejecuta el comando de perfil
   * @param {Object} comando - Objeto del comando de Slack
   * @param {Function} say - Función para enviar mensajes
   */
  async execute(comando, say) {
    try {
      // 1. Obtener información básica del usuario desde Slack
      const infoSlack = await ServicioPerfilUsuario.obtenerInfoSlack(comando.user_id);
      
      // 2. Obtener información detallada del funcionario desde la BD
      const infoFuncionario = await ServicioPerfilUsuario.obtenerInfoFuncionario(infoSlack.emailSlack);
      
      // 3. Construir y enviar mensaje con la información
      await say({
        text: `Perfil de ${infoFuncionario.FunNom || infoSlack.nombre}`,
        blocks: ConstructorMensajePerfil.construir(infoSlack, infoFuncionario)
      });

    } catch (error) {
      console.error('Error en comando perfil:', error);
      await say({
        text: 'Error al obtener el perfil',
        blocks: ConstructorMensajePerfil.construirError(error)
      });
    }
  }
}

module.exports = ComandoPerfil;