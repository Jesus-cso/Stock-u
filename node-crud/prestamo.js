const express = require("express");
const { sql, getPool } = require("./db");

const router = express.Router();

// Ver todos los préstamos activos
router.get("/", async (req, res, next) => {
    try {
        const pool = await getPool();

        const result = await pool.request().query(`
            SELECT
                pr.id_prestamo,
                pr.id_producto,
                p.nombre AS nombreProducto,
                p.codigo_barras,
                pr.persona,
                pr.cantidad,
                pr.nota,
                pr.fecha_prestamo,
                pr.fecha_devolucion_esp,
                pr.estado
            FROM Prestamos pr
            INNER JOIN Productos p ON p.id_producto = pr.id_producto
            WHERE pr.estado = 'activo'
            ORDER BY pr.fecha_prestamo DESC
        `);

        res.json(result.recordset);
    } catch (error) {
        next(error);
    }
});

// Registrar un préstamo (descuenta stock) - todo en una transacción
router.post("/", async (req, res, next) => {

    const { id_producto, persona, nota = null, fecha_devolucion_esp = null } = req.body;
    const cantidad = Number(req.body.cantidad);

    if (!Number.isInteger(Number(id_producto)) || Number(id_producto) <= 0
        || !persona || !Number.isInteger(cantidad) || cantidad <= 0) {
        return res.status(400).json({ error: "Faltan datos obligatorios (producto, persona, cantidad)." });
    }

    let transaction;

    try {
        const pool = await getPool();

        transaction = new sql.Transaction(pool);
        await transaction.begin();

        // Candado sobre el producto mientras se valida y descuenta
        const stockActual = await new sql.Request(transaction)
            .input("id", sql.Int, id_producto)
            .query(`
                SELECT stock, nombre
                FROM Productos WITH (UPDLOCK, HOLDLOCK)
                WHERE id_producto = @id
            `);

        if (stockActual.recordset.length === 0) {
            await transaction.rollback();
            return res.status(404).json({ error: "Producto no encontrado." });
        }

        if (stockActual.recordset[0].stock < cantidad) {
            await transaction.rollback();
            return res.status(400).json({
                error: `Stock insuficiente. Disponible: ${stockActual.recordset[0].stock}`
            });
        }

        const result = await new sql.Request(transaction)
            .input("id_producto", sql.Int, id_producto)
            .input("persona", sql.NVarChar(150), String(persona).trim())
            .input("cantidad", sql.Int, cantidad)
            .input("nota", sql.NVarChar(250), nota)
            .input("fecha_devolucion_esp", sql.Date, fecha_devolucion_esp)
            .query(`
                INSERT INTO Prestamos (id_producto, persona, cantidad, nota, fecha_devolucion_esp)
                OUTPUT INSERTED.id_prestamo
                VALUES (@id_producto, @persona, @cantidad, @nota, @fecha_devolucion_esp)
            `);

        await new sql.Request(transaction)
            .input("id", sql.Int, id_producto)
            .input("cantidad", sql.Int, cantidad)
            .query(`UPDATE Productos SET stock = stock - @cantidad WHERE id_producto = @id`);

        await transaction.commit();

        res.status(201).json({
            mensaje: "Préstamo registrado correctamente.",
            id_prestamo: result.recordset[0].id_prestamo
        });

    } catch (error) {
        if (transaction) {
            try { await transaction.rollback(); }
            catch (e) { /* ya estaba cerrada */ }
        }
        next(error);
    }
});

// Devolver un préstamo (regresa stock) - todo en una transacción
router.put("/:id/devolver", async (req, res, next) => {

    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "ID inválido." });
    }

    let transaction;

    try {
        const pool = await getPool();

        transaction = new sql.Transaction(pool);
        await transaction.begin();

        const prestamo = await new sql.Request(transaction)
            .input("id", sql.Int, id)
            .query(`
                SELECT id_producto, cantidad, estado
                FROM Prestamos WITH (UPDLOCK, HOLDLOCK)
                WHERE id_prestamo = @id
            `);

        if (prestamo.recordset.length === 0) {
            await transaction.rollback();
            return res.status(404).json({ error: "Préstamo no encontrado." });
        }

        if (prestamo.recordset[0].estado === "devuelto") {
            await transaction.rollback();
            return res.status(400).json({ error: "Este préstamo ya fue devuelto." });
        }

        const { id_producto, cantidad } = prestamo.recordset[0];

        await new sql.Request(transaction)
            .input("id", sql.Int, id)
            .query(`
                UPDATE Prestamos
                SET estado = 'devuelto', fecha_devolucion_real = GETDATE()
                WHERE id_prestamo = @id
            `);

        await new sql.Request(transaction)
            .input("id", sql.Int, id_producto)
            .input("cantidad", sql.Int, cantidad)
            .query(`UPDATE Productos SET stock = stock + @cantidad WHERE id_producto = @id`);

        await transaction.commit();

        res.json({ mensaje: "Préstamo devuelto y stock restaurado." });

    } catch (error) {
        if (transaction) {
            try { await transaction.rollback(); }
            catch (e) { /* ya estaba cerrada */ }
        }
        next(error);
    }
});

module.exports = router;