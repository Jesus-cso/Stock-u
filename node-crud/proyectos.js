const express = require("express");
const { sql, getPool } = require("./db");

const router = express.Router();

/*==================================
    BUSCAR PROYECTO POR NÚMERO
    GET /proyectos/numero/:numero

    200 -> {
        encontrado: true,
        proyecto: {
            id_proyecto,
            numero_proyecto, numero,      (mismo valor, dos nombres)
            nombre,                       (nombre del proyecto)
            id_lider,
            matricula_lider,
            nombre_lider, lider,          (mismo valor, dos nombres)
            area_lider
        }
    }
    404 -> { encontrado: false, mensaje }

    Se devuelven ambos nombres para que funcionen las dos
    pantallas (nota de salida y nota de entrada).
===================================*/
router.get("/numero/:numero", async (req, res, next) => {
    try {
        const pool = await getPool();

        const r = await pool.request()
            .input("numero", sql.NVarChar(30), String(req.params.numero).trim())
            .query(`
                SELECT p.id_proyecto,
                       p.numero_proyecto,
                       p.numero_proyecto AS numero,
                       p.nombre,
                       p.id_lider     AS id_lider,
                       m.matricula  AS matricula_lider,
                       m.nombre     AS nombre_lider,
                       m.nombre     AS lider,
                       m.area       AS area_lider
                FROM Proyectos p
                LEFT JOIN Miembros m ON m.id_miembro = p.id_lider
                WHERE p.numero_proyecto = @numero
            `);

        if (r.recordset.length === 0) {
            return res.status(404).json({
                encontrado: false,
                mensaje: "No existe un proyecto con ese número."
            });
        }

        res.json({ encontrado: true, proyecto: r.recordset[0] });
    } catch (error) {
        next(error);
    }
});

/*==================================
    REGISTRAR PROYECTO
    POST /proyectos
    Body: {
        "numero_proyecto": "123",
        "nombre": "Nombre del proyecto",     <-- opcional
        "matricula_lider": "12"
    }
    El líder se busca solo con su matrícula.
===================================*/
router.post("/", async (req, res, next) => {
    const { numero_proyecto, nombre, matricula_lider } = req.body;

    if (!numero_proyecto || String(numero_proyecto).trim() === "") {
        return res.status(400).json({ error: "Falta el número de proyecto." });
    }
    if (!matricula_lider || String(matricula_lider).trim() === "") {
        return res.status(400).json({ error: "Falta la matrícula del líder." });
    }

    try {
        const pool = await getPool();

        const lider = await pool.request()
            .input("matricula", sql.NVarChar(30), String(matricula_lider).trim())
            .query(`SELECT id_miembro, nombre, area FROM Miembros WHERE matricula = @matricula`);

        if (lider.recordset.length === 0) {
            return res.status(404).json({ error: "No existe un miembro con esa matrícula." });
        }

        const existe = await pool.request()
            .input("numero", sql.NVarChar(30), String(numero_proyecto).trim())
            .query(`SELECT 1 FROM Proyectos WHERE numero_proyecto = @numero`);

        if (existe.recordset.length > 0) {
            return res.status(409).json({ error: "Ya existe un proyecto con ese número." });
        }

        const ins = await pool.request()
            .input("numero", sql.NVarChar(30), String(numero_proyecto).trim())
            .input("nombre", sql.NVarChar(150), nombre ? String(nombre).trim() : null)
            .input("id_lider", sql.Int, lider.recordset[0].id_miembro)
            .query(`
                INSERT INTO Proyectos (numero_proyecto, nombre, id_lider)
                OUTPUT INSERTED.id_proyecto
                VALUES (@numero, @nombre, @id_lider)
            `);

        res.status(201).json({
            mensaje: "Proyecto registrado.",
            id_proyecto: ins.recordset[0].id_proyecto,
            lider: lider.recordset[0].nombre,
            area: lider.recordset[0].area
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
