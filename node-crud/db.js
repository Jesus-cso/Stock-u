const { Pool, types } = require("pg");

// =====================================================
// CONFIGURACIÓN POSTGRESQL
// Render entrega la conexión en DATABASE_URL
// =====================================================

// PostgreSQL devuelve bigint y numeric como texto; los pasamos a número
types.setTypeParser(20, (v) => Number(v));     // bigint
types.setTypeParser(1700, (v) => parseFloat(v)); // numeric

const url = process.env.DATABASE_URL;

if (!url) {
    throw new Error("Falta DATABASE_URL en el archivo .env o en las variables de Render");
}

const esLocal = /@(localhost|127\.0\.0\.1)/.test(url);

const config = {
    connectionString: url,
    ssl: esLocal ? false : { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 30000
};

// =====================================================
// CAPA DE COMPATIBILIDAD CON mssql
// Permite seguir usando en las rutas:
//   pool.request().input("x", sql.NVarChar(50), valor).query("... @x ...")
// El texto @x se convierte a $1 y el resultado trae .recordset
// =====================================================

// sql.NVarChar(50), sql.Int, sql.Bit, etc. ya no hacen nada: PostgreSQL deduce el tipo
const sql = new Proxy({}, {
    get: () => (...args) => ({})
});

class Peticion {
    constructor(pool) {
        this.pool = pool;
        this.parametros = [];
    }

    // input(nombre, valor)  o  input(nombre, tipo, valor)
    input(nombre, tipoOValor, valor) {
        const v = arguments.length === 2 ? tipoOValor : valor;
        this.parametros.push({ nombre, valor: v === undefined ? null : v });
        return this;
    }

    async query(texto) {
        const orden = [];
        const valores = [];

        const convertido = texto.replace(/(?<!@)@([A-Za-z_][A-Za-z0-9_]*)/g, (m, nombre) => {
            const p = this.parametros.find(x => x.nombre === nombre);
            if (!p) return m;

            let i = orden.indexOf(nombre);
            if (i === -1) {
                orden.push(nombre);
                valores.push(p.valor);
                i = orden.length - 1;
            }
            return "$" + (i + 1);
        });

        const r = await this.pool.query(convertido, valores);

        return {
            recordset: r.rows,
            recordsets: [r.rows],
            rowsAffected: [r.rowCount]
        };
    }
}

// =====================================================
// TRANSACCIONES
// Uso:  await pool.transaccion(async (request) => {
//           await request().input("id", 1).query("...");
//       });
// Si algo lanza un error se hace ROLLBACK de todo.
// =====================================================

async function transaccion(pgPool, trabajo) {
    const cliente = await pgPool.connect();
    try {
        await cliente.query("BEGIN");
        const resultado = await trabajo(() => new Peticion(cliente));
        await cliente.query("COMMIT");
        return resultado;
    } catch (error) {
        try { await cliente.query("ROLLBACK"); } catch (_) { }
        throw error;
    } finally {
        cliente.release();
    }
}

// =====================================================
// CONEXIÓN ÚNICA
// =====================================================

let pool = null;

async function getPool() {
    if (!pool) {
        pool = new Pool(config);

        pool.on("error", (error) => {
            console.error("❌ Error en pool PostgreSQL:", error.message);
        });

        try {
            await pool.query("SELECT 1");
            console.log("✅ (db.js) Conectado a PostgreSQL correctamente");
        } catch (error) {
            console.error("❌ Error conectando a PostgreSQL:", error.message);
            pool = null;
            throw error;
        }
    }

    return {
        transaccion: (trabajo) => transaccion(pool, trabajo),
        request: () => new Peticion(pool),
        query: (texto, valores) => pool.query(texto, valores)
    };
}

// =====================================================
// CERRAR CONEXIÓN
// =====================================================

async function closePool() {
    if (pool) {
        await pool.end();
        pool = null;
        console.log("🔌 Conexión PostgreSQL cerrada");
    }
}

module.exports = {
    sql,
    getPool,
    closePool
};