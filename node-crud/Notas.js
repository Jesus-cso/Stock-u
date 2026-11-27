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
    - Descuenta el stock (con trigger en la base o desde aquí).
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

    try {

        const pool = await getPool();

        const guardada = await pool.transaccion(async (request) => {

        // ---- Folio (secuencia compartida FolioSeq) ----
        await request()
            .query(`CREATE SEQUENCE IF NOT EXISTS folioseq START WITH 1 INCREMENT BY 1`);
        const folioResult = await request()
            .query(`SELECT nextval('folioseq') AS numero`);

        const folio = "UPT-S-" + folioResult.recordset[0].numero;

        // ---- Proyecto opcional ----
        let idProyecto = null;
        let liderProyecto = null;

        if (numero_proyecto !== undefined && numero_proyecto !== null
            && String(numero_proyecto).trim() !== "") {

            const proy = await request()
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
        const notaResult = await request()
            .input("matricula", sql.NVarChar(30), String(matricula).trim())
            .input("nombre", sql.NVarChar(150), String(nombre).trim())
            .input("area", sql.NVarChar(100), area ? String(area).trim() : null)
            .input("folio", sql.NVarChar(20), folio)
            .input("id_proyecto", sql.Int, idProyecto)
            .input("id_usuario", sql.Int, req.usuario.id_usuario)
            .query(`
                INSERT INTO Notas (matricula, nombre, area, folio, id_proyecto, id_usuario)
                VALUES (@matricula, @nombre, @area, @folio, @id_proyecto, @id_usuario)
                RETURNING id_nota
            `);

        const idNota = notaResult.recordset[0].id_nota;

        // ---- Renglones (con candado sobre el producto) ----
        for (const item of items) {

            const stockActual = await request()
                .input("id_producto", sql.Int, item.id_producto)
                .query(`
                    SELECT stock, nombre
                    FROM Productos
                    WHERE id_producto = @id_producto
                    FOR UPDATE
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

            await request()
                .input("id_producto", sql.Int, item.id_producto)
                .input("cantidad", sql.Int, item.cantidad)
                .input("id_nota", sql.Int, idNota)
                .query(`
                    INSERT INTO Salidas (id_producto, cantidad, id_nota)
                    VALUES (@id_producto, @cantidad, @id_nota)
                `);

            // Si la base tiene un trigger que descuenta el stock, ya cambió.
            // Si no lo tiene, se descuenta aquí (así nunca se descuenta doble).
            await request()
                .input("id_producto", sql.Int, item.id_producto)
                .input("cantidad", sql.Int, item.cantidad)
                .input("antes", sql.Int, stock)
                .query(`
                    UPDATE Productos SET stock = stock - @cantidad
                    WHERE id_producto = @id_producto AND stock = @antes
                `);
        }

        return {
            id_nota: idNota,
            folio,
            id_proyecto: idProyecto,
            lider_proyecto: liderProyecto
        };
        });

        res.status(201).json({
            mensaje: "Nota de salida guardada correctamente.",
            ...guardada
        });

    } catch (error) {

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

    try {

        const pool = await getPool();

        await pool.transaccion(async (request) => {

        const nota = await request()
            .input("id", sql.Int, idNota)
            .query(`SELECT estado FROM Notas WHERE id_nota = @id FOR UPDATE`);

        if (nota.recordset.length === 0) {
            throw new Error("La nota no existe.");
        }

        if (nota.recordset[0].estado === "cancelada") {
            throw new Error("La nota ya estaba cancelada.");
        }

        await request()
            .input("id", sql.Int, idNota)
            .query(`
                UPDATE Productos AS p
                SET stock = p.stock + s.total
                FROM (
                    SELECT id_producto, SUM(cantidad) AS total
                    FROM Salidas
                    WHERE id_nota = @id
                    GROUP BY id_producto
                ) s
                WHERE s.id_producto = p.id_producto
            `);

        await request()
            .input("id", sql.Int, idNota)
            .input("motivo", sql.NVarChar(200), motivo.slice(0, 200))
            .input("por", sql.Int, req.usuario.id_usuario)
            .query(`
                UPDATE Notas
                SET estado = 'cancelada',
                    fecha_cancelacion = NOW(),
                    motivo_cancelacion = @motivo,
                    cancelada_por = @por
                WHERE id_nota = @id
            `);

        });

        res.json({ mensaje: "Nota cancelada y stock devuelto." });

    } catch (error) {

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