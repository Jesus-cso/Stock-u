const express = require("express");
const { sql, getPool } = require("./db");

const router = express.Router();

/*==================================
    FUNCIONES QUE CONSTRUYEN CADA TIPO DE ALERTA
    (se reutilizan en los endpoints individuales y en GET /alertas,
    así la forma del JSON es idéntica en ambos lados)
===================================*/

// "Hoy" sin envolver la columna en CAST, para que SQL Server pueda usar índices
const HOY = (col) =>
    `${col} >= CAST(GETDATE() AS DATE) AND ${col} < DATEADD(DAY, 1, CAST(GETDATE() AS DATE))`;

async function getAlertasStock(pool) {
    const result = await pool.request().query(`
        SELECT
            p.id_producto,
            p.nombre,
            p.stock,
            p.stock_minimo,
            a.codigo AS anaquel,
            pr.nombre AS proveedor
        FROM Productos p
        LEFT JOIN Anaqueles a ON p.id_anaquel = a.id_anaquel
        LEFT JOIN Proveedores pr ON p.id_proveedor = pr.id_proveedor
        WHERE p.stock <= p.stock_minimo
        ORDER BY p.stock ASC
    `);

    return result.recordset.map(p => ({
        tipo: "stock",
        id_referencia: p.id_producto,
        titulo: p.nombre,
        detalle: `Quedan ${p.stock} unidades (mínimo: ${p.stock_minimo})` +
            (p.proveedor ? ` — Proveedor: ${p.proveedor}` : ""),
        critico: p.stock === 0,
        anaquel: p.anaquel || null,
        fecha: null
    }));
}

async function getAlertasSolicitudes(pool) {
    const result = await pool.request().query(`
        SELECT
            s.id_solicitud,
            s.cantidad,
            s.solicitante,
            s.fecha_solicitud,
            p.nombre AS producto,
            ar.nombre AS area
        FROM Solicitudes s
        INNER JOIN Productos p ON p.id_producto = s.id_producto
        LEFT JOIN Areas ar ON ar.id_area = s.id_area
        WHERE s.estado = 'pendiente'
        ORDER BY s.fecha_solicitud ASC
    `);

    return result.recordset.map(s => ({
        tipo: "solicitud",
        id_referencia: s.id_solicitud,
        titulo: `${s.producto} (x${s.cantidad})`,
        detalle: `Solicitado por: ${s.solicitante}` + (s.area ? ` — Área: ${s.area}` : ""),
        fecha: s.fecha_solicitud
    }));
}

async function getAlertasSalidas(pool) {
    const result = await pool.request().query(`
        SELECT
            n.id_nota,
            n.folio,
            n.matricula,
            n.nombre,
            n.area,
            n.fecha
        FROM Notas n
        WHERE ${HOY("n.fecha")}
        ORDER BY n.fecha DESC
    `);

    return result.recordset.map(n => ({
        tipo: "salida",
        id_referencia: n.id_nota,
        titulo: `Nota de salida ${n.folio || ("#" + n.id_nota)}`,
        detalle: `Entregada a ${n.nombre} (${n.matricula})` +
            (n.area ? ` — Área: ${n.area}` : ""),
        fecha: n.fecha
    }));
}

async function getAlertasEntradas(pool) {
    const result = await pool.request().query(`
        SELECT
            ne.id_nota,
            ne.folio,
            ne.fecha,
            ne.observaciones,
            pr.nombre AS proveedor,
            m.nombre AS miembro
        FROM NotasEntrada ne
        LEFT JOIN Proveedores pr ON pr.id_proveedor = ne.id_proveedor
        LEFT JOIN Miembros m ON m.id_miembro = ne.id_miembro
        WHERE ${HOY("ne.fecha")}
        ORDER BY ne.fecha DESC
    `);

    return result.recordset.map(n => ({
        tipo: "entrada",
        id_referencia: n.id_nota,
        titulo: `Nota de entrada ${n.folio || ("#" + n.id_nota)}`,
        detalle: `Proveedor: ${n.proveedor || "—"}` +
            (n.miembro ? ` — Recibió: ${n.miembro}` : "") +
            (n.observaciones ? ` — ${n.observaciones}` : ""),
        fecha: n.fecha
    }));
}

async function getAlertasProductos(pool) {
    const result = await pool.request().query(`
        SELECT
            p.id_producto,
            p.nombre,
            p.categoria,
            p.stock,
            p.codigo_barras,
            p.fecha_registro,
            pr.nombre AS proveedor
        FROM Productos p
        LEFT JOIN Proveedores pr ON pr.id_proveedor = p.id_proveedor
        WHERE ${HOY("p.fecha_registro")}
        ORDER BY p.fecha_registro DESC
    `);

    return result.recordset.map(p => ({
        tipo: "producto",
        id_referencia: p.id_producto,
        titulo: `Nuevo producto: ${p.nombre}`,
        detalle: `Categoría: ${p.categoria || "—"} — Stock inicial: ${p.stock}` +
            (p.codigo_barras ? ` — Código: ${p.codigo_barras}` : "") +
            (p.proveedor ? ` — Proveedor: ${p.proveedor}` : ""),
        fecha: p.fecha_registro
    }));
}

// NUEVO: préstamos activos; los que pasaron su fecha esperada se marcan como críticos
async function getAlertasPrestamos(pool) {
    const result = await pool.request().query(`
        SELECT
            pr.id_prestamo,
            pr.persona,
            pr.cantidad,
            pr.fecha_prestamo,
            pr.fecha_devolucion_esp,
            p.nombre AS producto,
            CASE
                WHEN pr.fecha_devolucion_esp IS NOT NULL
                     AND pr.fecha_devolucion_esp < CAST(GETDATE() AS DATE)
                THEN 1 ELSE 0
            END AS vencido
        FROM Prestamos pr
        INNER JOIN Productos p ON p.id_producto = pr.id_producto
        WHERE pr.estado = 'activo'
        ORDER BY vencido DESC, pr.fecha_prestamo DESC
    `);

    return result.recordset.map(pr => {
        const vencido = pr.vencido === 1;
        const devolucion = pr.fecha_devolucion_esp
            ? new Date(pr.fecha_devolucion_esp).toISOString().slice(0, 10)
            : null;

        return {
            tipo: "prestamo",
            id_referencia: pr.id_prestamo,
            titulo: `${pr.producto} (x${pr.cantidad})`,
            detalle: `Prestado a: ${pr.persona}` +
                (devolucion ? ` — Devolución esperada: ${devolucion}` : "") +
                (vencido ? " — VENCIDO" : ""),
            critico: vencido,
            fecha: pr.fecha_prestamo
        };
    });
}

// Envuelve una función de alertas en un endpoint GET
const endpoint = (fn) => async (req, res, next) => {
    try {
        const pool = await getPool();
        res.json(await fn(pool));
    } catch (error) {
        next(error);
    }
};

/*==================================
    ENDPOINTS INDIVIDUALES
===================================*/
router.get("/stock", endpoint(getAlertasStock));            // GET /alertas/stock
router.get("/solicitudes", endpoint(getAlertasSolicitudes)); // GET /alertas/solicitudes
router.get("/salidas", endpoint(getAlertasSalidas));         // GET /alertas/salidas (del día)
router.get("/entradas", endpoint(getAlertasEntradas));       // GET /alertas/entradas (del día)
router.get("/productos", endpoint(getAlertasProductos));     // GET /alertas/productos (del día)
router.get("/prestamos", endpoint(getAlertasPrestamos));     // GET /alertas/prestamos (activos)

/*==================================
    TODAS LAS ALERTAS JUNTAS
    GET /alertas
===================================*/
router.get("/", async (req, res, next) => {
    try {
        const pool = await getPool();

        // Las consultas son independientes, se lanzan en paralelo
        const [
            alertasStock,
            alertasSolicitudes,
            alertasSalidas,
            alertasEntradas,
            alertasProductos,
            alertasPrestamos
        ] = await Promise.all([
            getAlertasStock(pool),
            getAlertasSolicitudes(pool),
            getAlertasSalidas(pool),
            getAlertasEntradas(pool),
            getAlertasProductos(pool),
            getAlertasPrestamos(pool)
        ]);

        res.json({
            resumen: {
                stock: alertasStock.length,
                solicitudes: alertasSolicitudes.length,
                salidas: alertasSalidas.length,
                entradas: alertasEntradas.length,
                productos: alertasProductos.length,
                prestamos: alertasPrestamos.length
            },
            alertas: [
                ...alertasStock,
                ...alertasSolicitudes,
                ...alertasSalidas,
                ...alertasEntradas,
                ...alertasProductos,
                ...alertasPrestamos
            ]
        });

    } catch (error) {
        next(error);
    }
});

/*==================================
    APROBAR / RECHAZAR SOLICITUD
    PUT /alertas/solicitudes/:id
    body: { estado: "aprobada" | "rechazada" }
===================================*/
router.put("/solicitudes/:id", async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        const { estado } = req.body;

        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ error: "Id de solicitud inválido." });
        }

        if (!["aprobada", "rechazada"].includes(estado)) {
            return res.status(400).json({
                error: "El estado debe ser 'aprobada' o 'rechazada'."
            });
        }

        const pool = await getPool();

        // Solo se puede responder una solicitud que sigue pendiente
        const result = await pool.request()
            .input("id", sql.Int, id)
            .input("estado", sql.NVarChar(30), estado)
            .query(`
                UPDATE Solicitudes
                SET estado = @estado, fecha_respuesta = GETDATE()
                WHERE id_solicitud = @id AND estado = 'pendiente'
            `);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                error: "Solicitud no encontrada o ya fue respondida."
            });
        }

        res.json({ mensaje: `Solicitud marcada como ${estado}.` });

    } catch (error) {
        next(error);
    }
});

module.exports = router;