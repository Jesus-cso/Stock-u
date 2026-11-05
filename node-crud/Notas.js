const express = require("express");
const { sql, getPool } = require("./db");

const router = express.Router();

/*==================================
    LISTAR NOTAS DE SALIDA
    GET /Notas/salida  (también GET /Notas)

    Devuelve un arreglo de notas, cada una con:
    - todas las columnas de Notas (incluye id_proyecto)
    - numero_proyecto y lider_proyecto (si la nota tiene proyecto)
    - tipo: "salida"
    - items: [{ id_nota, id_producto, cantidad, producto }]
===================================*/
router.get(["/", "/salida"], async (req, res, next) => {
    try {
        const pool = await getPool();

        const notasResult = await pool.request().query(`
            SELECT n.*,
                   pr.numero_proyecto,
                   ml.nombre AS lider_proyecto
            FROM Notas n
            LEFT JOIN Proyectos pr ON pr.id_proyecto = n.id_proyecto
            LEFT JOIN Miembros ml  ON ml.id_miembro  = pr.id_lider
            ORDER BY n.id_nota DESC
        `);

        const itemsResult = await pool.request().query(`
            SELECT s.id_nota, s.id_producto, s.cantidad, p.nombre AS producto
            FROM Salidas s
            LEFT JOIN Productos p ON p.id_producto = s.id_producto
        `);

        const porNota = {};
        for (const it of itemsResult.recordset) {
            (porNota[it.id_nota] = porNota[it.id_nota] || []).push(it);
        }

        const notas = notasResult.recordset.map(n => ({
            ...n,
            tipo: "salida",
            items: porNota[n.id_nota] || []
        }));

        res.json(notas);
    } catch (error) {
        next(error);
    }
});


/*==================================
    GUARDAR NOTA DE SALIDA COMPLETA
    POST /Notas/salida

    Body esperado:
    {
        "matricula": "12",
        "nombre": "Carlos ...",
        "area": "Sistemas",
        "numero_proyecto": "PRY-001",      <-- opcional
        "items": [
            { "id_producto": 5, "cantidad": 3 },
            { "id_producto": 9, "cantidad": 1 }
        ]
    }

    - Crea el encabezado en Notas (con folio generado por FolioSeq).
    - Si viene numero_proyecto, busca el proyecto y guarda su id_proyecto.
    - Inserta cada producto/cantidad en Salidas, ligado a esa Nota.
    - El trigger TR_ActualizarStockSalida descuenta el stock solo.
    - Todo dentro de una transacción: si algo falla, no se guarda nada.
===================================*/
router.post("/salida", async (req, res, next) => {

    const { matricula, nombre, area, items, numero_proyecto } = req.body;

    if (!matricula || String(matricula).trim() === "") {
        return res.status(400).json({ error: "Falta la matrícula de quien recibe." });
    }

    if (!nombre || String(nombre).trim() === "") {
        return res.status(400).json({ error: "Falta el nombre de quien recibe." });
    }

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "La nota debe incluir al menos un producto." });
    }

    for (const item of items) {
        const idProductoValido = Number.isInteger(item.id_producto) && item.id_producto > 0;
        const cantidadValida = Number.isInteger(item.cantidad) && item.cantidad > 0;

        if (!idProductoValido || !cantidadValida) {
            return res.status(400).json({
                error: "Cada producto necesita id_producto y cantidad válidos (números enteros mayores a 0)."
            });
        }
    }

    let transaction;

    try {

        const pool = await getPool();

        transaction = new sql.Transaction(pool);
        await transaction.begin();

        // =================================================
        // GENERAR FOLIO (secuencia compartida FolioSeq)
        // =================================================

        const folioResult = await new sql.Request(transaction)
            .query(`SELECT NEXT VALUE FOR FolioSeq AS numero`);

        const folio = "UPT-S-" + folioResult.recordset[0].numero;


        // =================================================
        // RESOLVER PROYECTO (opcional) POR SU NÚMERO
        // =================================================

        let idProyecto = null;
        let liderProyecto = null;

        if (numero_proyecto !== undefined && numero_proyecto !== null
            && String(numero_proyecto).trim() !== "") {

            const proy = await new sql.Request(transaction)
                .input("numero", sql.NVarChar(30), String(numero_proyecto).trim())
                .query(`
                    SELECT p.id_proyecto, m.nombre AS lider
                    FROM Proyectos p
                    LEFT JOIN Miembros m ON m.id_miembro = p.id_lider
                    WHERE p.numero_proyecto = @numero
                `);

            if (proy.recordset.length === 0) {
                throw new Error(`El proyecto "${String(numero_proyecto).trim()}" no existe.`);
            }

            idProyecto = proy.recordset[0].id_proyecto;
            liderProyecto = proy.recordset[0].lider;
        }


        // =================================================
        // CREAR ENCABEZADO EN Notas
        // =================================================

        const notaResult = await new sql.Request(transaction)
            .input("matricula", sql.NVarChar(30), String(matricula).trim())
            .input("nombre", sql.NVarChar(150), String(nombre).trim())
            .input("area", sql.NVarChar(100), area ? String(area).trim() : null)
            .input("folio", sql.NVarChar(20), folio)
            .input("id_proyecto", sql.Int, idProyecto)
            .query(`
                INSERT INTO Notas (matricula, nombre, area, folio, id_proyecto)
                OUTPUT INSERTED.id_nota
                VALUES (@matricula, @nombre, @area, @folio, @id_proyecto)
            `);

        const idNota = notaResult.recordset[0].id_nota;


        // =================================================
        // VALIDAR STOCK DISPONIBLE Y CREAR RENGLONES EN Salidas
        // =================================================

        for (const item of items) {

            const stockActual = await new sql.Request(transaction)
                .input("id_producto", sql.Int, item.id_producto)
                .query(`SELECT stock, nombre FROM Productos WHERE id_producto = @id_producto`);

            if (stockActual.recordset.length === 0) {
                throw new Error(`El producto con id ${item.id_producto} no existe.`);
            }

            const { stock, nombre: nombreProducto } = stockActual.recordset[0];

            if (stock < item.cantidad) {
                throw new Error(
                    `Stock insuficiente para "${nombreProducto}": hay ${stock} y se pidieron ${item.cantidad}.`
                );
            }

            await new sql.Request(transaction)
                .input("id_producto", sql.Int, item.id_producto)
                .input("cantidad", sql.Int, item.cantidad)
                .input("id_nota", sql.Int, idNota)
                .query(`
                    INSERT INTO Salidas (id_producto, cantidad, id_nota)
                    VALUES (@id_producto, @cantidad, @id_nota)
                `);
        }


        await transaction.commit();


        res.status(201).json({
            mensaje: "Nota de salida guardada correctamente.",
            id_nota: idNota,
            folio,
            id_proyecto: idProyecto,
            lider_proyecto: liderProyecto
        });

    } catch (error) {

        if (transaction) {
            try {
                await transaction.rollback();
            } catch (errorRollback) {
                console.error("❌ Error al hacer rollback:", errorRollback);
            }
        }

        // Errores de negocio (stock insuficiente, producto o proyecto
        // inexistente) se devuelven como 400 en vez de 500.

        if (error.message && (
            error.message.includes("Stock insuficiente") ||
            error.message.includes("no existe")
        )) {
            return res.status(400).json({ error: error.message });
        }

        next(error);
    }
});

module.exports = router;8