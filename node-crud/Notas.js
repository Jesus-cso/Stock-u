const express = require("express");
const { sql, getPool } = require("./db");

const router = express.Router();

/*==================================
    LISTAR NOTAS DE SALIDA
    GET /Notas/salida  (también GET /Notas)

    Devuelve un arreglo de notas, cada una con:
    - todas las columnas de Notas (incluye id_proyecto, id_usuario, estado)
    - numero_proyecto y lider_proyecto (si la nota tiene proyecto)
    - capturista: nombre del usuario que registró la salida
    - tipo: "salida"
    - items: [{ id_nota, id_producto, cantidad, producto }]
===================================*/
router.get(["/", "/salida"], async (req, res, next) => {
    try {
        const pool = await getPool();

        const notasResult = await pool.request().query(`
            SELECT n.*,
                   pr.numero_proyecto,
                   ml.nombre AS lider_proyecto,
                   u.nombre  AS capturista
            FROM Notas n
            LEFT JOIN Proyectos pr ON pr.id_proyecto = n.id_proyecto
            LEFT JOIN Miembros ml  ON ml.id_miembro  = pr.id_lider
            LEFT JOIN Usuarios u   ON u.id_usuario   = n.id_usuario
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
    POST /Notas/salida   (requiere token)

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

    - Crea el encabezado en Notas (folio generado por FolioSeq)
      y guarda qué usuario del sistema la capturó.
    - Bloquea la fila de cada producto mientras valida el stock,
      así dos capturistas no pueden sacar el mismo último producto.
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

        // ---- Folio (secuencia compartida FolioSeq) ----
        const folioResult = await new sql.Request(transaction)
            .query(`SELECT NEXT VALUE FOR FolioSeq AS numero`);

        const folio = "UPT-S-" + folioResult.recordset[0].numero;

        // ---- Proyecto opcional ----
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

        // ---- Encabezado ----
        const notaResult = await new sql.Request(transaction)
            .input("matricula", sql.NVarChar(30), String(matricula).trim())
            .input("nombre", sql.NVarChar(150), String(nombre).trim())
            .input("area", sql.NVarChar(100), area ? String(area).trim() : null)
            .input("folio", sql.NVarChar(20), folio)
            .input("id_proyecto", sql.Int, idProyecto)
            .input("id_usuario", sql.Int, req.usuario.id_usuario)
            .query(`
                INSERT INTO Notas (matricula, nombre, area, folio, id_proyecto, id_usuario)
                OUTPUT INSERTED.id_nota
                VALUES (@matricula, @nombre, @area, @folio, @id_proyecto, @id_usuario)
            `);

        const idNota = notaResult.recordset[0].id_nota;

        // ---- Renglones (con candado sobre el producto) ----
        for (const item of items) {

            const stockActual = await new sql.Request(transaction)
                .input("id_producto", sql.Int, item.id_producto)
                .query(`
                    SELECT stock, nombre
                    FROM Productos WITH (UPDLOCK, HOLDLOCK)
                    WHERE id_producto = @id_producto
                `);

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

        // Errores de negocio -> 400 en vez de 500
        if (error.message && (
            error.message.includes("Stock insuficiente") ||
            error.message.includes("no existe")
        )) {
            return res.status(400).json({ error: error.message });
        }

        next(error);
    }
});


/*==================================
    CANCELAR NOTA DE SALIDA
    PUT /Notas/:id/cancelar   body: { "motivo": "Error de captura" }

    - Devuelve al stock lo que salió en esa nota.
    - La nota NO se borra: queda marcada como cancelada, con
      motivo, fecha y quién la canceló.
    - Si la nota ya estaba cancelada, responde 400.

    OJO: si tu trigger TR_ActualizarStockSalida también se dispara en
    UPDATE/DELETE sobre Salidas, revísalo; aquí no se toca Salidas.
===================================*/
router.put("/:id/cancelar", async (req, res, next) => {

    const idNota = Number(req.params.id);
    const motivo = String(req.body?.motivo ?? "").trim();

    if (!Number.isInteger(idNota) || idNota <= 0) {
        return res.status(400).json({ error: "ID de nota inválido." });
    }

    if (motivo.length < 5) {
        return res.status(400).json({ error: "Escribe el motivo de la cancelación." });
    }

    let transaction;

    try {

        const pool = await getPool();

        transaction = new sql.Transaction(pool);
        await transaction.begin();

        const nota = await new sql.Request(transaction)
            .input("id", sql.Int, idNota)
            .query(`SELECT estado FROM Notas WITH (UPDLOCK, HOLDLOCK) WHERE id_nota = @id`);

        if (nota.recordset.length === 0) {
            throw new Error("La nota no existe.");
        }

        if (nota.recordset[0].estado === "cancelada") {
            throw new Error("La nota ya estaba cancelada.");
        }

        await new sql.Request(transaction)
            .input("id", sql.Int, idNota)
            .query(`
                UPDATE p
                SET p.stock = p.stock + s.total
                FROM Productos p
                JOIN (
                    SELECT id_producto, SUM(cantidad) AS total
                    FROM Salidas
                    WHERE id_nota = @id
                    GROUP BY id_producto
                ) s ON s.id_producto = p.id_producto
            `);

        await new sql.Request(transaction)
            .input("id", sql.Int, idNota)
            .input("motivo", sql.NVarChar(200), motivo.slice(0, 200))
            .input("por", sql.Int, req.usuario.id_usuario)
            .query(`
                UPDATE Notas
                SET estado = 'cancelada',
                    fecha_cancelacion = GETDATE(),
                    motivo_cancelacion = @motivo,
                    cancelada_por = @por
                WHERE id_nota = @id
            `);

        await transaction.commit();

        res.json({ mensaje: "Nota cancelada y stock devuelto." });

    } catch (error) {

        if (transaction) {
            try {
                await transaction.rollback();
            } catch (errorRollback) {
                console.error("❌ Error al hacer rollback:", errorRollback);
            }
        }

        if (error.message && (
            error.message.includes("no existe") ||
            error.message.includes("ya estaba cancelada")
        )) {
            return res.status(400).json({ error: error.message });
        }

        next(error);
    }
});

module.exports = router;