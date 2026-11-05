const sql = require("mssql");
require("dotenv").config();

const requiredEnvVars = [
    "DB_SERVER",
    "DB_USER",
    "DB_PASSWORD",
    "DB_NAME"
];

const missingVars = requiredEnvVars.filter(
    varName => !process.env[varName]
);

if (missingVars.length > 0) {
    console.error(
        `❌ ERROR: Falta configurar estas variables en .env: ${missingVars.join(", ")}`
    );
    process.exit(1);
}

const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    port: Number(process.env.DB_PORT) || 1433,
    database: process.env.DB_NAME,
    options: {
        encrypt: false,
        trustServerCertificate: true
    }
};

let poolPromise = null;

// Función para crear conexión con reintentos
async function conectar(intentos = 3, delay = 2000) {
    for (let i = 0; i < intentos; i++) {
        try {
            const pool = new sql.ConnectionPool(config);
            await pool.connect();
            console.log("✅ (db.js) Conectado a SQL Server correctamente");
            return pool;
        } catch (error) {
            console.error(
                `⚠️ (db.js) Intento ${i + 1}/${intentos} fallido:`,
                error.message
            );

            if (i < intentos - 1) {
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                console.error(
                    "❌ (db.js) Error fatal: No se pudo conectar a SQL Server"
                );
                throw error;
            }
        }
    }
}

// Inicializar pool
poolPromise = conectar();

async function getPool() {
    if (!poolPromise) {
        poolPromise = conectar();
    }
    return poolPromise;
}

// Cerrar conexión al salir
process.on("SIGINT", async () => {
    console.log("\n⏹️ Cerrando conexión a base de datos...");
    try {
        const pool = await poolPromise;
        await pool.close();
        console.log("✅ Conexión cerrada");
    } catch (error) {
        console.error("❌ Error al cerrar:", error.message);
    }
    process.exit(0);
});

module.exports = {
    sql,
    getPool
};