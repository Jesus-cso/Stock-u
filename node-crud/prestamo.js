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
                p.nombre AS "nombreProducto",
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

    try {
        const pool = await getPool();

        const idPrestamo = await pool.transaccion(async (request) => {
            // Candado sobre el producto mientras se valida y descuenta
            const producto = await request()
                .input("id", Number(id_producto))
                .query(`SELECT stock FROM Productos WHERE id_producto = @id FOR UPDATE`);

            if (producto.recordset.length === 0) {
                throw Object.assign(new Error("Producto no encontrado."), { status: 404 });
            }

            if (producto.recordset[0].stock < cantidad) {
                throw Object.assign(
                    new Error(`Stock insuficiente. Disponible: ${producto.recordset[0].stock}`),
                    { status: 400 }
                );
            }

            const nuevo = await request()
                .input("id_producto", Number(id_producto))
                .input("persona", String(persona).trim())
                .input("cantidad", cantidad)
                .input("nota", nota || null)
                .input("fecha_devolucion_esp", fecha_devolucion_esp || null)
                .query(`
                    INSERT INTO Prestamos (id_producto, persona, cantidad, nota, fecha_devolucion_esp)
                    VALUES (@id_producto, @persona, @cantidad, @nota, @fecha_devolucion_esp)
                    RETURNING id_prestamo
                `);

            await request()
                .input("id", Number(id_producto))
                .input("cantidad", cantidad)
                .query(`UPDATE Productos SET stock = stock - @cantidad WHERE id_producto = @id`);

            return nuevo.recordset[0].id_prestamo;
        });

        res.status(201).json({
            mensaje: "Préstamo registrado correctamente.",
            id_prestamo: idPrestamo
        });

    } catch (error) {
        if (error.status) return res.status(error.status).json({ error: error.message });
        next(error);
    }
});

// Devolver un préstamo (regresa stock) - todo en una transacción
router.put("/:id/devolver", async (req, res, next) => {

    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "ID inválido." });
    }

    try {
        const pool = await getPool();

        await pool.transaccion(async (request) => {
            const prestamo = await request()
                .input("id", id)
                .query(`
                    SELECT id_producto, cantidad, estado
                    FROM Prestamos WHERE id_prestamo = @id
                    FOR UPDATE
                `);

            if (prestamo.recordset.length === 0) {
                throw Object.assign(new Error("Préstamo no encontrado."), { status: 404 });
            }

            if (prestamo.recordset[0].estado === "devuelto") {
                throw Object.assign(new Error("Este préstamo ya fue devuelto."), { status: 400 });
            }

            const { id_producto, cantidad } = prestamo.recordset[0];

            await request()
                .input("id", id)
                .query(`
                    UPDATE Prestamos
                    SET estado = 'devuelto', fecha_devolucion_real = NOW()
                    WHERE id_prestamo = @id
                `);

            await request()
                .input("id", id_producto)
                .input("cantidad", cantidad)
                .query(`UPDATE Productos SET stock = stock + @cantidad WHERE id_producto = @id`);
        });

        res.json({ mensaje: "Préstamo devuelto y stock restaurado." });

    } catch (error) {
        if (error.status) return res.status(error.status).json({ error: error.message });
        next(error);
    }
});

module.exports = router;