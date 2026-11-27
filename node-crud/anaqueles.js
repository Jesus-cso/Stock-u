const express = require("express");
const { sql, getPool } = require("./db");

const router = express.Router();

// Ver todos los anaqueles
router.get("/", async (req, res, next) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT id_anaquel, codigo, ubicacion, descripcion, contenido
            FROM Anaqueles
            ORDER BY id_anaquel DESC
        `);
        res.json(result.recordset);
    } catch (error) {
        console.error("Error al obtener anaqueles:", error);
        next(error);
    }
});

// Crear anaquel
router.post("/", async (req, res, next) => {
    try {
        const { codigo, ubicacion = null, descripcion = null, contenido = null } = req.body;

        // Validar código
        if (!codigo || String(codigo).trim() === "") {
            return res.status(400).json({
                error: "El nombre/código del anaquel es obligatorio."
            });
        }

        const pool = await getPool();
        const result = await pool.request()
            .input("codigo", sql.NVarChar(50), String(codigo).trim())
            .input("ubicacion", sql.NVarChar(150), ubicacion ? String(ubicacion).trim() : null)
            .input("descripcion", sql.NVarChar(250), descripcion ? String(descripcion).trim() : null)
            .input("contenido", sql.NVarChar(150), contenido ? String(contenido).trim() : null)
            .query(`
                INSERT INTO Anaqueles (codigo, ubicacion, descripcion, contenido)
                VALUES (@codigo, @ubicacion, @descripcion, @contenido)
                RETURNING id_anaquel
            `);

        res.status(201).json({
            mensaje: "Anaquel creado correctamente.",
            id_anaquel: result.recordset[0].id_anaquel
        });
    } catch (error) {
        console.error("Error creando anaquel:", error);

        // Error de clave duplicada (unique constraint)
        if (error.code === "23505") {
            return res.status(409).json({
                error: "Ya existe un anaquel con ese nombre/código. Usa uno diferente."
            });
        }
        next(error);
    }
});

// Actualizar anaquel
router.put("/:id", async (req, res, next) => {
    try {
        const id = Number(req.params.id);

        // Validar ID
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ error: "ID inválido." });
        }

        const { codigo, ubicacion = null, descripcion = null, contenido = null } = req.body;

        // Validar código
        if (!codigo || String(codigo).trim() === "") {
            return res.status(400).json({
                error: "El nombre/código del anaquel es obligatorio."
            });
        }

        const pool = await getPool();
        const result = await pool.request()
            .input("id", sql.Int, id)
            .input("codigo", sql.NVarChar(50), String(codigo).trim())
            .input("ubicacion", sql.NVarChar(150), ubicacion ? String(ubicacion).trim() : null)
            .input("descripcion", sql.NVarChar(250), descripcion ? String(descripcion).trim() : null)
            .input("contenido", sql.NVarChar(150), contenido ? String(contenido).trim() : null)
            .query(`
                UPDATE Anaqueles
                SET codigo = @codigo,
                    ubicacion = @ubicacion,
                    descripcion = @descripcion,
                    contenido = @contenido
                WHERE id_anaquel = @id
            `);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({ error: "Anaquel no encontrado." });
        }

        res.json({ mensaje: "Anaquel actualizado correctamente." });
    } catch (error) {
        console.error("Error actualizando anaquel:", error);

        if (error.code === "23505") {
            return res.status(409).json({
                error: "Ya existe un anaquel con ese nombre/código."
            });
        }
        next(error);
    }
});

// Eliminar anaquel
router.delete("/:id", async (req, res, next) => {
    try {
        const id = Number(req.params.id);

        // Validar ID
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ error: "ID inválido." });
        }

        const pool = await getPool();
        const result = await pool.request()
            .input("id", sql.Int, id)
            .query(`DELETE FROM Anaqueles WHERE id_anaquel = @id`);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({ error: "Anaquel no encontrado." });
        }

        res.json({ mensaje: "Anaquel eliminado correctamente." });
    } catch (error) {
        console.error("Error eliminando anaquel:", error);
        next(error);
    }
});

module.exports = router;