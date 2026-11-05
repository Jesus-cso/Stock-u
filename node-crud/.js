const express = require("express");
const { sql, getPool } = require("./db");

const router = express.Router();

/*==================================
    ALERTAS DE STOCK BAJO/CRÍTICO
    GET /alertas/stock
===================================*/
router.get("/stock", async (req, res, next) => {
    try {
        const pool = await getPool();

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

        const alertas = result.recordset.map(p => ({
            tipo: "stock",
            id_referencia: p.id_producto,
            titulo: p.nombre,
            detalle: `Quedan ${p.stock} unidades (mínimo: ${p.stock_minimo})` +
                (p.proveedor ? ` — Proveedor: ${p.proveedor}` : ""),
            critico: p.stock === 0,
            anaquel: p.anaquel || null
        }));

        res.json(alertas);

    } catch (error) {
        next(error);
    }
});

/*==================================
    ALERTAS DE SOLICITUDES PENDIENTES
    GET /alertas/solicitudes
===================================*/
router.get("/solicitudes", async (req, res, next) => {
    try {
        const pool = await getPool();

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

        const alertas = result.recordset.map(s => ({
            tipo: "solicitud",
            id_referencia: s.id_solicitud,
            titulo: `${s.producto} (x${s.cantidad})`,
            detalle: `Solicitado por: ${s.solicitante}` + (s.area ? ` — Área: ${s.area}` : ""),
            fecha: s.fecha_solicitud
        }));

        res.json(alertas);

    } catch (error) {
        next(error);
    }
});

/*==================================
    ALERTAS DE NOTAS DE SALIDA (DEL DÍA)
    GET /alertas/salidas

    Reporta las notas de salida (tabla Notas) registradas
    el día de hoy, como aviso informativo de movimiento
    de almacén (no es un "problema" como stock bajo, pero
    se reporta igual en el feed de alertas/actividad).
===================================*/
router.get("/salidas", async (req, res, next) => {
    try {
        const pool = await getPool();

        const result = await pool.request().query(`
            SELECT
                n.id_nota,
                n.folio,
                n.matricula,
                n.nombre,
                n.area,
                n.fecha
            FROM Notas n
            WHERE CAST(n.fecha AS DATE) = CAST(GETDATE() AS DATE)
            ORDER BY n.fecha DESC
        `);

        const alertas = result.recordset.map(n => ({
            tipo: "salida",
            id_referencia: n.id_nota,
            titulo: `Nota de salida ${n.folio || ("#" + n.id_nota)}`,
            detalle: `Entregada a ${n.nombre} (${n.matricula})` +
                (n.area ? ` — Área: ${n.area}` : ""),
            fecha: n.fecha
        }));

        res.json(alertas);

    } catch (error) {
        next(error);
    }
});

/*==================================
    ALERTAS DE NOTAS DE ENTRADA (DEL DÍA)
    GET /alertas/entradas

    Reporta las notas de entrada (tabla NotasEntrada)
    registradas el día de hoy.
===================================*/
router.get("/entradas", async (req, res, next) => {
    try {
        const pool = await getPool();

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
            WHERE CAST(ne.fecha AS DATE) = CAST(GETDATE() AS DATE)
            ORDER BY ne.fecha DESC
        `);

        const alertas = result.recordset.map(n => ({
            tipo: "entrada",
            id_referencia: n.id_nota,
            titulo: `Nota de entrada ${n.folio || ("#" + n.id_nota)}`,
            detalle: `Proveedor: ${n.proveedor || "—"}` +
                (n.miembro ? ` — Recibió: ${n.miembro}` : "") +
                (n.observaciones ? ` — ${n.observaciones}` : ""),
            fecha: n.fecha
        }));

        res.json(alertas);

    } catch (error) {
        next(error);
    }
});

/*==================================
    TODAS LAS ALERTAS JUNTAS
    GET /alertas
    (stock bajo + solicitudes pendientes + notas de
    salida/entrada del día. "préstamos" queda pendiente:
    no existe tabla de préstamos todavía)
===================================*/
router.get("/", async (req, res, next) => {
    try {
        const pool = await getPool();

        const stockResult = await pool.request().query(`
            SELECT
                p.id_producto,
                p.nombre,
                p.stock,
                p.stock_minimo,
                pr.nombre AS proveedor
            FROM Productos p
            LEFT JOIN Proveedores pr ON p.id_proveedor = pr.id_proveedor
            WHERE p.stock <= p.stock_minimo
        `);

        const solicitudesResult = await pool.request().query(`
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
        `);

        const salidasResult = await pool.request().query(`
            SELECT
                n.id_nota,
                n.folio,
                n.matricula,
                n.nombre,
                n.area,
                n.fecha
            FROM Notas n
            WHERE CAST(n.fecha AS DATE) = CAST(GETDATE() AS DATE)
        `);

        const entradasResult = await pool.request().query(`
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
            WHERE CAST(ne.fecha AS DATE) = CAST(GETDATE() AS DATE)
        `);

        const alertasStock = stockResult.recordset.map(p => ({
            tipo: "stock",
            id_referencia: p.id_producto,
            titulo: p.nombre,
            detalle: `Quedan ${p.stock} unidades (mínimo: ${p.stock_minimo})` +
                (p.proveedor ? ` — Proveedor: ${p.proveedor}` : ""),
            fecha: null
        }));

        const alertasSolicitudes = solicitudesResult.recordset.map(s => ({
            tipo: "solicitud",
            id_referencia: s.id_solicitud,
            titulo: `${s.producto} (x${s.cantidad})`,
            detalle: `Solicitado por: ${s.solicitante}` + (s.area ? ` — Área: ${s.area}` : ""),
            fecha: s.fecha_solicitud
        }));

        const alertasSalidas = salidasResult.recordset.map(n => ({
            tipo: "salida",
            id_referencia: n.id_nota,
            titulo: `Nota de salida ${n.folio || ("#" + n.id_nota)}`,
            detalle: `Entregada a ${n.nombre} (${n.matricula})` +
                (n.area ? ` — Área: ${n.area}` : ""),
            fecha: n.fecha
        }));

        const alertasEntradas = entradasResult.recordset.map(n => ({
            tipo: "entrada",
            id_referencia: n.id_nota,
            titulo: `Nota de entrada ${n.folio || ("#" + n.id_nota)}`,
            detalle: `Proveedor: ${n.proveedor || "—"}` +
                (n.miembro ? ` — Recibió: ${n.miembro}` : "") +
                (n.observaciones ? ` — ${n.observaciones}` : ""),
            fecha: n.fecha
        }));

        res.json({
            resumen: {
                stock: alertasStock.length,
                solicitudes: alertasSolicitudes.length,
                salidas: alertasSalidas.length,
                entradas: alertasEntradas.length,
                prestamos: 0 // pendiente: no existe tabla de préstamos aún
            },
            alertas: [
                ...alertasStock,
                ...alertasSolicitudes,
                ...alertasSalidas,
                ...alertasEntradas
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
        const { id } = req.params;
        const { estado } = req.body;

        if (!["aprobada", "rechazada"].includes(estado)) {
            return res.status(400).json({
                error: "El estado debe ser 'aprobada' o 'rechazada'."
            });
        }

        const pool = await getPool();

        const result = await pool.request()
            .input("id", sql.Int, id)
            .input("estado", sql.NVarChar(30), estado)
            .query(`
                UPDATE Solicitudes
                SET estado = @estado, fecha_respuesta = GETDATE()
                WHERE id_solicitud = @id
            `);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({ error: "Solicitud no encontrada." });
        }

        res.json({ mensaje: `Solicitud marcada como ${estado}.` });

    } catch (error) {
        next(error);
    }
});

module.exports = router;