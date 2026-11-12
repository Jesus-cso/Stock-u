const express = require("express");
const PDFDocument = require("pdfkit");
const { sql, getPool } = require("./db");

const router = express.Router();

/*==================================
    NOTA DE SALIDA EN PDF (para firmar)
    GET /Notas/:id/pdf   (requiere token en el header Authorization)

    Desde el front hay que pedirla con fetch + token y abrir el blob:
        const r = await api(`http://localhost:3000/Notas/${id}/pdf`);
        const url = URL.createObjectURL(await r.blob());
        window.open(url);
===================================*/
router.get("/:id/pdf", async (req, res, next) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ error: "ID inválido." });
        }

        const pool = await getPool();

        const notaRes = await pool.request()
            .input("id", sql.Int, id)
            .query(`
                SELECT n.*,
                       pr.numero_proyecto,
                       ml.nombre AS lider_proyecto,
                       u.nombre  AS capturista
                FROM Notas n
                LEFT JOIN Proyectos pr ON pr.id_proyecto = n.id_proyecto
                LEFT JOIN Miembros ml  ON ml.id_miembro  = pr.id_lider
                LEFT JOIN Usuarios u   ON u.id_usuario   = n.id_usuario
                WHERE n.id_nota = @id
            `);

        if (notaRes.recordset.length === 0) {
            return res.status(404).json({ error: "Nota no encontrada." });
        }

        const nota = notaRes.recordset[0];

        const itemsRes = await pool.request()
            .input("id", sql.Int, id)
            .query(`
                SELECT s.cantidad, p.nombre, p.codigo_barras
                FROM Salidas s
                LEFT JOIN Productos p ON p.id_producto = s.id_producto
                WHERE s.id_nota = @id
            `);

        const doc = new PDFDocument({ size: "LETTER", margin: 50 });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="${nota.folio}.pdf"`);
        doc.pipe(res);

        // Encabezado
        doc.fontSize(18).text("NOTA DE SALIDA DE ALMACÉN", { align: "center" });
        doc.moveDown(0.3);
        doc.fontSize(12).text(`Folio: ${nota.folio}`, { align: "center" });

        if (nota.estado === "cancelada") {
            doc.moveDown(0.3);
            doc.fillColor("red").fontSize(14).text("*** NOTA CANCELADA ***", { align: "center" });
            doc.fillColor("black");
        }

        doc.moveDown();
        doc.fontSize(11);
        doc.text(`Fecha: ${nota.fecha ? new Date(nota.fecha).toLocaleString("es-MX") : "-"}`);
        doc.text(`Recibe: ${nota.nombre}  (matrícula ${nota.matricula})`);
        doc.text(`Área: ${nota.area || "-"}`);
        if (nota.numero_proyecto) {
            doc.text(`Proyecto: ${nota.numero_proyecto}  Líder: ${nota.lider_proyecto || "-"}`);
        }
        doc.text(`Capturó: ${nota.capturista || "-"}`);

        // Tabla de productos
        doc.moveDown();
        const xCant = 50, xProd = 110, xCod = 420;
        let y = doc.y;
        doc.font("Helvetica-Bold");
        doc.text("Cant.", xCant, y);
        doc.text("Producto", xProd, y);
        doc.text("Código", xCod, y);
        doc.font("Helvetica");
        y += 18;
        doc.moveTo(50, y - 4).lineTo(560, y - 4).stroke();

        for (const it of itemsRes.recordset) {
            if (y > 680) { doc.addPage(); y = 60; }
            doc.text(String(it.cantidad), xCant, y);
            doc.text(it.nombre || "(sin nombre)", xProd, y, { width: 300 });
            doc.text(it.codigo_barras || "-", xCod, y);
            y += 18;
        }

        // Firmas
        const yFirma = Math.max(y + 60, 640);
        if (yFirma > 720) { doc.addPage(); }
        const yf = yFirma > 720 ? 120 : yFirma;

        doc.moveTo(70, yf).lineTo(250, yf).stroke();
        doc.moveTo(330, yf).lineTo(510, yf).stroke();
        doc.fontSize(10);
        doc.text("Entrega (almacén)", 70, yf + 5, { width: 180, align: "center" });
        doc.text("Recibe", 330, yf + 5, { width: 180, align: "center" });
        doc.text(nota.nombre, 330, yf + 20, { width: 180, align: "center" });

        doc.end();

    } catch (error) {
        next(error);
    }
});

module.exports = router;