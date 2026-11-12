
const sql = require("mssql");

// =====================================================
// CONFIGURACIÓN SQL SERVER
// =====================================================

const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER || "127.0.0.1",
    port: Number(process.env.DB_PORT) || 1433,
    database: process.env.DB_NAME || "VistasStockDB",

    options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true
    },

    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    },

    connectionTimeout: 30000,
    requestTimeout: 30000
};

// =====================================================
// VALIDAR CONFIGURACIÓN
// =====================================================

if (!config.user || !config.password) {
    throw new Error(
        "Faltan DB_USER o DB_PASSWORD en el archivo .env"
    );
}

// =====================================================
// CONEXIÓN ÚNICA
// =====================================================

let poolPromise = null;

async function getPool() {
    try {
        if (!poolPromise) {
            const pool = new sql.ConnectionPool(config);

            pool.on("error", (error) => {
                console.error("❌ Error en pool SQL:", error.message);
            });

            poolPromise = pool.connect()
                .then((connectedPool) => {
                    console.log(
                        "✅ (db.js) Conectado a SQL Server correctamente"
                    );

                    return connectedPool;
                })
                .catch((error) => {
                    poolPromise = null;

                    console.error(
                        "❌ Error conectando a SQL Server:",
                        error.message
                    );

                    throw error;
                });
        }

        return await poolPromise;

    } catch (error) {
        throw error;
    }
}

// =====================================================
// CERRAR CONEXIÓN
// =====================================================

async function closePool() {
    if (poolPromise) {
        const pool = await poolPromise;
        await pool.close();
        poolPromise = null;

        console.log("🔌 Conexión SQL Server cerrada");
    }
}

// =====================================================
// EXPORTAR
// =====================================================

module.exports = {
    sql,
    getPool,
    closePool
};
