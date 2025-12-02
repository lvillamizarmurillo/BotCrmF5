// Importar la configuración y la instancia del pool de conexiones a la base de datos.
const { pool, poolConnect } = require('../db/conection.js');

/**
 * @class Funcionarios
 * @description Clase que actúa como un servicio o controlador para manejar la lógica de negocio
 * relacionada con las consultas de la entidad 'Funcionarios'.
 */
class Funcionarios {
    /**
     * @static
     * @async
     * @method getFun
     * @description Maneja la solicitud para obtener una lista de todos los funcionarios activos.
     * Este método es un manejador de rutas de Express.
     *
     * @param {Object} req - El objeto de solicitud de Express, contiene la información de la petición HTTP.
     * @param {Object} res - El objeto de respuesta de Express, usado para enviar la respuesta al cliente.
     */
    static async getFun(req, res) {
        try {
            // Asegurarse de que el pool de conexiones esté listo antes de usarlo.
            await poolConnect;
            // Crear una nueva solicitud al pool de conexiones.
            const request = pool.request();

            // Ejecutar una consulta SQL para seleccionar todos los funcionarios con estado 'A' (Activo).
            const result = await request.query("SELECT * FROM Funcionarios WHERE FunEst = 'A'");
            
            // Enviar una respuesta JSON exitosa (código 200 por defecto) al cliente.
            res.json({
                success: true,
                message: 'Conexión exitosa a SQL Server',
                data: result // Los datos obtenidos de la consulta.
            });
        } catch (error) {
            // Si ocurre un error durante la conexión o la consulta...
            console.error('Error en la conexión o consulta:', error);
            // Enviar una respuesta de error con código de estado 500 (Error Interno del Servidor).
            res.status(500).json({
                success: false,
                message: 'Error al conectar con la base de datos o al realizar la consulta.',
                error: error.message // Mensaje específico del error.
            });
        }
    }
}

// Exportar la clase para que sus métodos puedan ser utilizados por el enrutador.
module.exports = Funcionarios;