const express = require("express");
const { sql, getPool } = require("./db");

const router = express.Router();


// =====================================================
// OBTENER TODOS LOS MIEMBROS
// GET /miembros
// =====================================================

router.get("/", async (req, res, next) => {
    try {

        const pool = await getPool();

        const result = await pool.request().query(`
            SELECT
                id_miembro,
                matricula,
                nombre,
                area,
                telefono,
                activo,
                fecha_registro
            FROM Miembros
            ORDER BY id_miembro DESC
        `);

        res.json(result.recordset);

    } catch (error) {
        next(error);
    }
});


// =====================================================
// OBTENER MIEMBRO POR MATRÍCULA
// GET /miembros/matricula/20231001
// =====================================================

router.get("/matricula/:matricula", async (req, res, next) => {
    try {

        const matricula = req.params.matricula.trim();

        if (!matricula) {
            return res.status(400).json({
                error: "La matrícula es obligatoria."
            });
        }

        const pool = await getPool();

        const result = await pool.request()
            .input(
                "matricula",
                sql.NVarChar(30),
                matricula
            )
            .query(`
                SELECT
                    id_miembro,
                    matricula,
                    nombre,
                    area,
                    telefono,
                    activo,
                    fecha_registro
                FROM Miembros
                WHERE matricula = @matricula
                  AND activo = 1
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                error: "Miembro no encontrado."
            });
        }

        res.json(result.recordset[0]);

    } catch (error) {
        next(error);
    }
});


// =====================================================
// OBTENER MIEMBRO POR ID
// GET /miembros/1
// =====================================================

router.get("/:id", async (req, res, next) => {
    try {

        const id = Number(req.params.id);

        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({
                error: "ID inválido."
            });
        }

        const pool = await getPool();

        const result = await pool.request()
            .input("id", sql.Int, id)
            .query(`
                SELECT
                    id_miembro,
                    matricula,
                    nombre,
                    area,
                    telefono,
                    activo,
                    fecha_registro
                FROM Miembros
                WHERE id_miembro = @id
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                error: "Miembro no encontrado."
            });
        }

        res.json(result.recordset[0]);

    } catch (error) {
        next(error);
    }
});


// =====================================================
// CREAR MIEMBRO
// POST /miembros
// =====================================================

router.post("/", async (req, res, next) => {
    try {

        const {
            matricula,
            nombre,
            area = null,
            telefono = null
        } = req.body;

        if (!matricula || matricula.trim() === "") {
            return res.status(400).json({
                error: "La matrícula es obligatoria."
            });
        }

        if (!nombre || nombre.trim() === "") {
            return res.status(400).json({
                error: "El nombre es obligatorio."
            });
        }

        const pool = await getPool();

        // Verificar matrícula duplicada
        const existe = await pool.request()
            .input(
                "matricula",
                sql.NVarChar(30),
                matricula.trim()
            )
            .query(`
                SELECT id_miembro
                FROM Miembros
                WHERE matricula = @matricula
            `);

        if (existe.recordset.length > 0) {
            return res.status(400).json({
                error: "La matrícula ya existe."
            });
        }

        const result = await pool.request()
            .input(
                "matricula",
                sql.NVarChar(30),
                matricula.trim()
            )
            .input(
                "nombre",
                sql.NVarChar(150),
                nombre.trim()
            )
            .input(
                "area",
                sql.NVarChar(100),
                area ? area.trim() : null
            )
            .input(
                "telefono",
                sql.NVarChar(20),
                telefono ? telefono.trim() : null
            )
            .query(`
                INSERT INTO Miembros
                (
                    matricula,
                    nombre,
                    area,
                    telefono
                )
                OUTPUT INSERTED.id_miembro
                VALUES
                (
                    @matricula,
                    @nombre,
                    @area,
                    @telefono
                )
            `);

        res.status(201).json({
            mensaje: "Miembro registrado correctamente.",
            id_miembro: result.recordset[0].id_miembro
        });

    } catch (error) {
        next(error);
    }
});


// =====================================================
// ACTUALIZAR MIEMBRO
// PUT /miembros/1
// =====================================================

router.put("/:id", async (req, res, next) => {
    try {

        const id = Number(req.params.id);

        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({
                error: "ID inválido."
            });
        }

        const {
            matricula,
            nombre,
            area = null,
            telefono = null,
            activo = true
        } = req.body;

        if (!matricula || matricula.trim() === "") {
            return res.status(400).json({
                error: "La matrícula es obligatoria."
            });
        }

        if (!nombre || nombre.trim() === "") {
            return res.status(400).json({
                error: "El nombre es obligatorio."
            });
        }

        const pool = await getPool();

        // Verificar que no exista otra matrícula igual
        const existe = await pool.request()
            .input(
                "matricula",
                sql.NVarChar(30),
                matricula.trim()
            )
            .input("id", sql.Int, id)
            .query(`
                SELECT id_miembro
                FROM Miembros
                WHERE matricula = @matricula
                  AND id_miembro <> @id
            `);

        if (existe.recordset.length > 0) {
            return res.status(400).json({
                error: "La matrícula ya pertenece a otro miembro."
            });
        }

        const result = await pool.request()
            .input("id", sql.Int, id)
            .input(
                "matricula",
                sql.NVarChar(30),
                matricula.trim()
            )
            .input(
                "nombre",
                sql.NVarChar(150),
                nombre.trim()
            )
            .input(
                "area",
                sql.NVarChar(100),
                area ? area.trim() : null
            )
            .input(
                "telefono",
                sql.NVarChar(20),
                telefono ? telefono.trim() : null
            )
            .input(
                "activo",
                sql.Bit,
                activo
            )
            .query(`
                UPDATE Miembros
                SET
                    matricula = @matricula,
                    nombre = @nombre,
                    area = @area,
                    telefono = @telefono,
                    activo = @activo
                WHERE id_miembro = @id
            `);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                error: "Miembro no encontrado."
            });
        }

        res.json({
            mensaje: "Miembro actualizado correctamente."
        });

    } catch (error) {
        next(error);
    }
});


// =====================================================
// ELIMINAR MIEMBRO
// DELETE /miembros/1
// =====================================================

router.delete("/:id", async (req, res, next) => {
    try {

        const id = Number(req.params.id);

        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({
                error: "ID inválido."
            });
        }

        const pool = await getPool();

        const result = await pool.request()
            .input("id", sql.Int, id)
            .query(`
                DELETE FROM Miembros
                WHERE id_miembro = @id
            `);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                error: "Miembro no encontrado."
            });
        }

        res.json({
            mensaje: "Miembro eliminado correctamente."
        });

    } catch (error) {
        next(error);
    }
});


module.exports = router;