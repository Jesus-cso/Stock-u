const express = require("express");
const { sql, getPool } = require("./db");

const router = express.Router();

// Ver todos los productos
router.get("/", async (req, res, next) => {
    try {
        const pool = await getPool();

        const result = await pool.request().query(`
            SELECT
                p.id_producto,
                p.nombre,
                p.descripcion,
                p.categoria,
                p.marca,
                p.precio,
                p.stock,
                p.stock_minimo,
                p.codigo_barras,
                a.codigo AS anaquel,
                pr.nombre AS proveedor
            FROM Productos p
            LEFT JOIN Anaqueles a ON p.id_anaquel = a.id_anaquel
            LEFT JOIN Proveedores pr ON p.id_proveedor = pr.id_proveedor
            ORDER BY p.id_producto DESC
        `);

        res.json(result.recordset);
    } catch (error) {
        next(error);
    }
});

// Ver un producto por ID
router.get("/:id", async (req, res, next) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ error: "ID inválido." });
        }

        const pool = await getPool();

        const result = await pool
            .request()
            .input("id", sql.Int, id)
            .query(`
                SELECT
                    p.id_producto,
                    p.nombre,
                    p.descripcion,
                    p.categoria,
                    p.marca,
                    p.precio,
                    p.stock,
                    p.stock_minimo,
                    p.codigo_barras,
                    p.id_anaquel,
                    p.id_proveedor
                FROM Productos p
                WHERE p.id_producto = @id
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({ error: "Producto no encontrado." });
        }

        res.json(result.recordset[0]);
    } catch (error) {
        next(error);
    }
});

/*==================================
    BUSCAR PRODUCTO POR CÓDIGO DE BARRAS
    GET /productos/codigo/:codigo

    Usado por el escáner del celular: al leer un código,
    consulta aquí si el producto ya existe.
===================================*/
router.get("/codigo/:codigo", async (req, res, next) => {
    try {
        const { codigo } = req.params;
        const pool = await getPool();

        const result = await pool
            .request()
            .input("codigo", sql.NVarChar(50), codigo)
            .query(`
                SELECT
                    p.id_producto,
                    p.nombre,
                    p.descripcion,
                    p.categoria,
                    p.marca,
                    p.precio,
                    p.stock,
                    p.stock_minimo,
                    p.codigo_barras,
                    a.codigo AS anaquel,
                    pr.nombre AS proveedor
                FROM Productos p
                LEFT JOIN Anaqueles a ON p.id_anaquel = a.id_anaquel
                LEFT JOIN Proveedores pr ON p.id_proveedor = pr.id_proveedor
                WHERE p.codigo_barras = @codigo
            `);

        if (result.recordset.length === 0) {
            // No es un error: simplemente no existe todavía ese código.
            // El front-end decide si ofrece crear un producto nuevo.
            return res.status(404).json({
                encontrado: false,
                mensaje: "No hay ningún producto con ese código de barras."
            });
        }

        res.json({
            encontrado: true,
            producto: result.recordset[0]
        });

    } catch (error) {
        next(error);
    }
});

// Crear producto
router.post("/", async (req, res, next) => {
    try {
        const {
            nombre,
            descripcion = null,
            categoria = null,
            marca = null,
            precio = null,
            stock = 0,
            stock_minimo = 5,
            id_anaquel = null,
            id_proveedor = null,
            codigo_barras = null
        } = req.body;

        if (!nombre || String(nombre).trim() === "") {
            return res.status(400).json({ error: "El nombre es obligatorio." });
        }

        const pool = await getPool();

        // Si viene código de barras, verificar que no esté repetido
        if (codigo_barras) {
            const existe = await pool.request()
                .input("codigo", sql.NVarChar(50), codigo_barras)
                .query(`SELECT id_producto FROM Productos WHERE codigo_barras = @codigo`);

            if (existe.recordset.length > 0) {
                return res.status(409).json({
                    error: "Ya existe un producto con ese código de barras.",
                    id_producto: existe.recordset[0].id_producto
                });
            }
        }

        const result = await pool
            .request()
            .input("nombre", sql.NVarChar(100), String(nombre).trim())
            .input("descripcion", sql.NVarChar(250), descripcion)
            .input("categoria", sql.NVarChar(100), categoria)
            .input("marca", sql.NVarChar(100), marca)
            .input("precio", sql.Decimal(10, 2), precio)
            .input("stock", sql.Int, Number(stock))
            .input("stock_minimo", sql.Int, Number(stock_minimo))
            .input("id_anaquel", sql.Int, id_anaquel)
            .input("id_proveedor", sql.Int, id_proveedor)
            .input("codigo_barras", sql.NVarChar(50), codigo_barras)
            .query(`
                INSERT INTO Productos (
                    nombre, descripcion, categoria, marca, precio, stock, stock_minimo,
                    id_anaquel, id_proveedor, codigo_barras
                )
                VALUES (
                    @nombre, @descripcion, @categoria, @marca, @precio, @stock, @stock_minimo,
                    @id_anaquel, @id_proveedor, @codigo_barras
                )
                RETURNING id_producto
            `);

        res.status(201).json({
            mensaje: "Producto creado correctamente.",
            id_producto: result.recordset[0].id_producto
        });
    } catch (error) {
        next(error);
    }
});

// Actualizar producto
router.put("/:id", async (req, res, next) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ error: "ID inválido." });
        }

        const pool = await getPool();

        const actual = await pool.request()
            .input("id", sql.Int, id)
            .query(`SELECT * FROM Productos WHERE id_producto = @id`);

        if (actual.recordset.length === 0) {
            return res.status(404).json({ error: "Producto no encontrado." });
        }

        // Los campos que no vienen en la petición conservan su valor
        const {
            nombre,
            descripcion,
            categoria,
            marca,
            precio,
            stock,
            stock_minimo,
            id_anaquel,
            id_proveedor,
            codigo_barras
        } = { ...actual.recordset[0], ...req.body };

        if (!nombre || String(nombre).trim() === "") {
            return res.status(400).json({ error: "El nombre es obligatorio." });
        }

        if (codigo_barras) {
            const existe = await pool.request()
                .input("codigo", sql.NVarChar(50), codigo_barras)
                .input("id", sql.Int, id)
                .query(`
                    SELECT id_producto FROM Productos
                    WHERE codigo_barras = @codigo AND id_producto != @id
                `);

            if (existe.recordset.length > 0) {
                return res.status(409).json({
                    error: "Ya existe OTRO producto con ese código de barras."
                });
            }
        }

        const result = await pool
            .request()
            .input("id", sql.Int, id)
            .input("nombre", sql.NVarChar(100), String(nombre).trim())
            .input("descripcion", sql.NVarChar(250), descripcion)
            .input("categoria", sql.NVarChar(100), categoria)
            .input("marca", sql.NVarChar(100), marca)
            .input("precio", sql.Decimal(10, 2), precio)
            .input("stock", sql.Int, Number(stock))
            .input("stock_minimo", sql.Int, Number(stock_minimo))
            .input("id_anaquel", sql.Int, id_anaquel)
            .input("id_proveedor", sql.Int, id_proveedor)
            .input("codigo_barras", sql.NVarChar(50), codigo_barras)
            .query(`
                UPDATE Productos SET
                    nombre = @nombre,
                    descripcion = @descripcion,
                    categoria = @categoria,
                    marca = @marca,
                    precio = @precio,
                    stock = @stock,
                    stock_minimo = @stock_minimo,
                    id_anaquel = @id_anaquel,
                    id_proveedor = @id_proveedor,
                    codigo_barras = @codigo_barras
                WHERE id_producto = @id
            `);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({ error: "Producto no encontrado." });
        }

        res.json({ mensaje: "Producto actualizado correctamente." });
    } catch (error) {
        next(error);
    }
});

// Eliminar producto
router.delete("/:id", async (req, res, next) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ error: "ID inválido." });
        }

        const pool = await getPool();

        const result = await pool
            .request()
            .input("id", sql.Int, id)
            .query(`DELETE FROM Productos WHERE id_producto = @id`);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({ error: "Producto no encontrado." });
        }

        res.json({ mensaje: "Producto eliminado correctamente." });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
