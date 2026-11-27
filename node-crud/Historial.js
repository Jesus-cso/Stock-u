const express = require("express");
const { sql, getPool } = require("./db");

const router = express.Router();

/*==================================
    HISTORIAL DE MOVIMIENTOS
    (Notas de Entrada + Notas de Salida)
    GET /historial

    Query params opcionales:
      ?tipo=Entrada|Salida   -> filtra por tipo de movimiento
      ?mes=Junio             -> filtra por mes (nombre en español)

    Tablas reales usadas:
      Entrada: NotasEntrada + DetalleNotaEntrada
      Salida:  Notas (encabezado) + Salidas (cada línea de producto,
               ya trae id_producto/cantidad/unidad/id_nota; no existe
               una tabla "DetalleNotaSalida" aparte).

    Nota: las columnas "aprobado" (control de calidad) y
    "aTiempo" (entrega a tiempo) NO existen todavía en el
    esquema. Se devuelven con valor por defecto (true) para no
    romper el front-end que ya consume esos campos. Si quieres
    que sean reales, hay que agregar esas columnas a las tablas
    y quitar el default de este archivo (marcado con TODO más abajo).
===================================*/
router.get("/", async (req, res, next) => {
    try {
        const { tipo, mes } = req.query;
        const pool = await getPool();

        const meses = [
            "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
            "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
        ];

        const result = await pool.request().query(`
            SELECT
                n.folio,
                'Entrada' AS tipo,
                pr.nombre AS producto,
                d.cantidad,
                n.fecha,
                EXTRACT(MONTH FROM n.fecha)::int AS mes_num
            FROM NotasEntrada n
            INNER JOIN DetalleNotaEntrada d ON d.id_nota = n.id_nota
            INNER JOIN Productos pr ON pr.id_producto = d.id_producto

            UNION ALL

            SELECT
                n.folio,
                'Salida' AS tipo,
                pr.nombre AS producto,
                s.cantidad,
                n.fecha,
                EXTRACT(MONTH FROM n.fecha)::int AS mes_num
            FROM Notas n
            INNER JOIN Salidas s   ON s.id_nota = n.id_nota
            INNER JOIN Productos pr ON pr.id_producto = s.id_producto
            WHERE n.folio IS NOT NULL

            ORDER BY fecha DESC
        `);

        let movimientos = result.recordset.map(row => ({
            folio: row.folio,
            tipo: row.tipo,
            producto: row.producto,
            cantidad: row.cantidad,
            fecha: row.fecha,
            mes: meses[row.mes_num - 1],
            // TODO: reemplazar por columnas reales cuando existan
            aprobado: true,
            aTiempo: true
        }));

        if (tipo && tipo !== "todos") {
            movimientos = movimientos.filter(m => m.tipo === tipo);
        }

        if (mes && mes !== "todos") {
            movimientos = movimientos.filter(m => m.mes === mes);
        }

        res.json(movimientos);

    } catch (error) {
        next(error);
    }
});

module.exports = router;