const { pool, poolConnect } = require('../db/conection.js');

class Funcionarios {
    static async getFun(req, res) {
        try {
            await poolConnect;
            const request = pool.request();

            const result = await request.query("SELECT * FROM Funcionarios WHERE FunEst = 'A'");
            res.json({
                success: true,
                message: 'Conexión exitosa a SQL Server',
                data: result
            });
        } catch (error) {
            console.error('Error en la conexión:', error);
            res.status(500).json({
                success: false,
                message: 'Error al conectar con la base de datos',
                error: error.message
            });
        }
    }
}

module.exports = Funcionarios;