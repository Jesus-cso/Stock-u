const express = require("express");
const { sql, getPool } = require("./db");
const { enviarCorreoNotaEntrada } = require("./mailer");

const router = express.Router();

async function generarFolio(request) {
    await request.query(`
        CREATE SEQUENCE IF NOT EXISTS folioseq START WITH 1 INCREMENT BY 1
    `);
    const result = await request.query(`
        SELECT nextval('folioseq') AS numero
    `);
    const numero = result.recordset[0].numero;
    return "F-" + String(numero).padStart(6, "0");
}

router.get("/siguientes-consecutivos", async (req, res, next) => {
    try {
        const pool = await getPool();
        const rReq = await pool.request().query(`
            SELECT requisicion FROM NotasEntrada WHERE requisicion LIKE 'R-%' ORDER BY id_nota DESC LIMIT 1
        `);
        const rFac = await pool.request().query(`
            SELECT factura FROM NotasEntrada WHERE factura LIKE 'F-%' ORDER BY id_nota DESC LIMIT 1
        `);

        let nextReq = "R-000001";
        if (rReq.recordset.length > 0 && rReq.recordset[0].requisicion) {
            const match = rReq.recordset[0].requisicion.match(/\d+/);
            if (match) {
                const num = parseInt(match[0], 10) + 1;
                nextReq = "R-" + String(num).padStart(6, "0");
            }
        }

        let nextFac = "F-000001";
        if (rFac.recordset.length > 0 && rFac.recordset[0].factura) {
            const match = rFac.recordset[0].factura.match(/\d+/);
            if (match) {
                const num = parseInt(match[0], 10) + 1;
                nextFac = "F-" + String(num).padStart(6, "0");
            }
        }

        res.json({ requisicion: nextReq, factura: nextFac });
    } catch (error) {
        next(error);
    }
});

function textoOpcional(valor, max, etiqueta) {
    if (valor === undefined || valor === null) return null;
    const t = String(valor).trim();
    if (t === "") return null;
    if (t.length > max) {
        const e = new Error(`${etiqueta} no puede pasar de ${max} caracteres.`);
        e.status400 = true;
        throw e;
    }
    return t;
}

function idOpcional(valor, etiqueta) {
    if (valor === undefined || valor === null || valor === "") return null;
    const n = Number(valor);
    if (!Number.isInteger(n) || n <= 0) {
        const e = new Error(`${etiqueta} no es válido.`);
        e.status400 = true;
        throw e;
    }
    return n;
}

async function existeRegistro(pool, tabla, columna, id) {
    const r = await pool.request()
        .input("id", sql.Int, id)
        .query(`SELECT 1 AS ok FROM ${tabla} WHERE ${columna} = @id`);
    return r.recordset.length > 0;
}

function mensajeFK(error) {
    const m = `${error.constraint || ""} ${error.message || ""}`.toLowerCase();
    if (m.includes("fk_notamiembro")) return "El miembro indicado no existe en Miembros.";
    if (m.includes("fk_notaproveedor")) return "El proveedor seleccionado no existe.";
    if (m.includes("fk_notasentrada_proyectos")) return "El proyecto seleccionado no existe.";
    if (m.includes("fk_detalleproducto")) return "Uno de los productos de la nota no existe.";
    return null;
}

router.get("/", async (req, res, next) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT
                n.id_nota, n.folio, n.fecha, n.observaciones,
                n.id_proveedor, p.nombre AS proveedor,
                n.id_miembro, m.nombre AS miembro,
                n.id_proyecto, pr.numero_proyecto,
                (
                    SELECT SUM(d.cantidad * d.precio_unitario)
                    FROM DetalleNotaEntrada d
                    WHERE d.id_nota = n.id_nota
                ) AS total
            FROM NotasEntrada n
            LEFT JOIN Proveedores p ON p.id_proveedor = n.id_proveedor
            LEFT JOIN Miembros m ON m.id_miembro = n.id_miembro
            LEFT JOIN Proyectos pr ON pr.id_proyecto = n.id_proyecto
            ORDER BY n.id_nota DESC
        `);
        res.json(result.recordset);
    } catch (error) {
        next(error);
    }
});

router.get("/:id", async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ error: "El id de la nota no es válido." });
        }

        const pool = await getPool();
        const nota = await pool.request()
            .input("id_nota", sql.Int, id)
            .query(`
                SELECT
                    n.id_nota, n.folio, n.fecha, n.observaciones,
                    n.id_proveedor, p.nombre AS proveedor,
                    n.id_miembro, m.nombre AS miembro,
                    n.id_proyecto, pr.numero_proyecto,
                    CASE
                        WHEN pr.id_proyecto IS NULL THEN NULL
                        ELSE pr.numero_proyecto::text ||
                             CASE WHEN COALESCE(pr.nombre, '') <> ''
                                  THEN ' - ' || pr.nombre ELSE '' END
                    END AS proyecto,
                    ml.nombre AS lider_proyecto,
                    n.requisicion, n.factura,
                    n.fuente_financiamiento, n.tipo_financiamiento,
                    n.num_pedido, n.orden_compra
                FROM NotasEntrada n
                LEFT JOIN Proveedores p ON p.id_proveedor = n.id_proveedor
                LEFT JOIN Miembros m ON m.id_miembro = n.id_miembro
                LEFT JOIN Proyectos pr ON pr.id_proyecto = n.id_proyecto
                LEFT JOIN Miembros ml ON ml.id_miembro = pr.id_lider
                WHERE n.id_nota = @id_nota
            `);

        if (nota.recordset.length === 0) {
            return res.status(404).json({ error: "Nota de entrada no encontrada." });
        }

        const detalle = await pool.request()
            .input("id_nota", sql.Int, id)
            .query(`
                SELECT
                    d.id_detalle, d.id_producto, pr.nombre AS producto,
                    d.cantidad, d.unidad, d.precio_unitario,
                    (d.cantidad * d.precio_unitario) AS total_renglon
                FROM DetalleNotaEntrada d
                INNER JOIN Productos pr ON pr.id_producto = d.id_producto
                WHERE d.id_nota = @id_nota
            `);

        res.json({
            ...nota.recordset[0],
            productos: detalle.recordset
        });
    } catch (error) {
        next(error);
    }
});

router.post("/", async (req, res, next) => {
    try {
        const pool = await getPool();

        const { id_proveedor, id_miembro, id_proyecto, observaciones, productos } = req.body;

        if (!id_proveedor) {
            return res.status(400).json({ error: "id_proveedor es obligatorio." });
        }

        const idProveedor = Number(id_proveedor);
        if (!Number.isInteger(idProveedor) || idProveedor <= 0) {
            return res.status(400).json({ error: "id_proveedor no es válido." });
        }

        if (!Array.isArray(productos) || productos.length === 0) {
            return res.status(400).json({ error: "Debes incluir al menos un producto en la nota." });
        }

        const idProyecto = idOpcional(id_proyecto, "id_proyecto");
        const idMiembro = idOpcional(id_miembro, "id_miembro");

        let fuente = textoOpcional(req.body.fuente_financiamiento, 100, "La fuente de financiamiento");
        if (!fuente) {
            fuente = "PUA";
        }

        const requisicion = textoOpcional(req.body.requisicion, 50, "La requisición");
        const factura = textoOpcional(req.body.factura, 50, "La factura");
        const tipoFin = textoOpcional(req.body.tipo_financiamiento, 30, "El tipo de financiamiento");
        const numPedido = textoOpcional(req.body.num_pedido, 50, "El número de pedido");
        const ordenCompra = textoOpcional(req.body.orden_compra, 50, "La orden de compra");
        const obs = textoOpcional(observaciones, 300, "Las observaciones");

        if (!(await existeRegistro(pool, "Proveedores", "id_proveedor", idProveedor))) {
            return res.status(400).json({ error: `El proveedor con id ${idProveedor} no existe.` });
        }

        if (idMiembro !== null && !(await existeRegistro(pool, "Miembros", "id_miembro", idMiembro))) {
            return res.status(400).json({ error: `El miembro con id ${idMiembro} no existe.` });
        }

        if (idProyecto !== null && !(await existeRegistro(pool, "Proyectos", "id_proyecto", idProyecto))) {
            return res.status(400).json({ error: `El proyecto con id ${idProyecto} no existe.` });
        }

        for (const item of productos) {
            const cant = Number(item.cantidad);
            if (!Number.isInteger(Number(item.id_producto)) || Number(item.id_producto) <= 0
                || Number.isNaN(cant) || cant <= 0) {
                return res.status(400).json({ error: "Cada producto necesita id_producto y cantidad válidos." });
            }
        }

        const notaCreada = await pool.transaccion(async (request) => {
            const folio = await generarFolio(request());

            const resultNota = await request()
                .input("folio", sql.NVarChar(20), folio)
                .input("id_proveedor", sql.Int, idProveedor)
                .input("id_miembro", sql.Int, idMiembro)
                .input("id_proyecto", sql.Int, idProyecto)
                .input("observaciones", sql.NVarChar(300), obs)
                .input("requisicion", sql.NVarChar(50), requisicion)
                .input("factura", sql.NVarChar(50), factura)
                .input("fuente", sql.NVarChar(100), fuente)
                .input("tipo_fin", sql.NVarChar(30), tipoFin)
                .input("num_pedido", sql.NVarChar(50), numPedido)
                .input("orden_compra", sql.NVarChar(50), ordenCompra)
                .query(`
                    INSERT INTO NotasEntrada (
                        folio, id_proveedor, id_miembro, id_proyecto, observaciones,
                        requisicion, factura, fuente_financiamiento,
                        tipo_financiamiento, num_pedido, orden_compra
                    )
                    VALUES (
                        @folio, @id_proveedor, @id_miembro, @id_proyecto, @observaciones,
                        @requisicion, @factura, @fuente,
                        @tipo_fin, @num_pedido, @orden_compra
                    )
                    RETURNING id_nota, folio, fecha
                `);

            const creada = resultNota.recordset[0];

            for (const item of productos) {
                const cantidadNum = Number(item.cantidad);
                const precioNum = Number(item.precio_unitario ?? 0);
                const unidadLimpia = item.unidad ? String(item.unidad).trim() || null : null;

                await request()
                    .input("id_nota", sql.Int, creada.id_nota)
                    .input("id_producto", sql.Int, Number(item.id_producto))
                    .input("cantidad", sql.Decimal(10, 2), cantidadNum)
                    .input("precio_unitario", sql.Decimal(10, 2), precioNum)
                    .input("unidad", sql.NVarChar(20), unidadLimpia)
                    .query(`
                        INSERT INTO DetalleNotaEntrada (id_nota, id_producto, cantidad, precio_unitario, unidad)
                        VALUES (@id_nota, @id_producto, @cantidad, @precio_unitario, @unidad)
                    `);

                await request()
                    .input("id_producto", sql.Int, Number(item.id_producto))
                    .input("cantidad", sql.Decimal(10, 2), cantidadNum)
                    .query(`
                        UPDATE Productos
                        SET stock = COALESCE(stock, 0) + @cantidad
                        WHERE id_producto = @id_producto
                    `);
            }

            return creada;
        });

        res.status(201).json({
            mensaje: "Nota de entrada registrada correctamente.",
            id_nota: notaCreada.id_nota,
            folio: notaCreada.folio,
            fecha: notaCreada.fecha,
            productos: productos
        });

    } catch (error) {
        if (error.status400) return res.status(400).json({ error: error.message });
        if (error.code === "23503") {
            const mensaje = mensajeFK(error);
            if (mensaje) return res.status(400).json({ error: mensaje });
        }
        next(error);
    }
});

module.exports = router;
