const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS
    }
});

async function enviarCorreoNotaEntrada(nota) {
    try {
        const filasProductos = nota.productos.map(p => `
            <tr>
                <td style="padding:6px 10px;border:1px solid #ddd;">${p.nombre}</td>
                <td style="padding:6px 10px;border:1px solid #ddd;">${p.cantidad}</td>
                <td style="padding:6px 10px;border:1px solid #ddd;">$${Number(p.precio_unitario).toFixed(2)}</td>
                <td style="padding:6px 10px;border:1px solid #ddd;">$${(p.cantidad * p.precio_unitario).toFixed(2)}</td>
            </tr>
        `).join("");

        const totalNota = nota.productos.reduce(
            (acc, p) => acc + (p.cantidad * p.precio_unitario), 0
        );

        const html = `
            <h2>Nota de Entrada ${nota.folio}</h2>
            <p><strong>Fecha:</strong> ${new Date(nota.fecha).toLocaleString("es-MX")}</p>
            <p><strong>Proveedor:</strong> ${nota.proveedor || "—"}</p>
            <p><strong>Recibió:</strong> ${nota.miembro || "—"}</p>
            <p><strong>Observaciones:</strong> ${nota.observaciones || "—"}</p>
            <table style="border-collapse:collapse;margin-top:10px;">
                <thead>
                    <tr>
                        <th style="padding:6px 10px;border:1px solid #ddd;background:#f4f4f4;">Producto</th>
                        <th style="padding:6px 10px;border:1px solid #ddd;background:#f4f4f4;">Cant.</th>
                        <th style="padding:6px 10px;border:1px solid #ddd;background:#f4f4f4;">P. Unit.</th>
                        <th style="padding:6px 10px;border:1px solid #ddd;background:#f4f4f4;">Subtotal</th>
                    </tr>
                </thead>
                <tbody>${filasProductos}</tbody>
            </table>
            <p style="margin-top:10px;"><strong>Total: $${totalNota.toFixed(2)}</strong></p>
        `;

        await transporter.sendMail({
            from: '"Sistema de Inventario" <notificaciones@vistasstock.com>',
            to: process.env.MAIL_TO,
            subject: `Nueva nota de entrada registrada: ${nota.folio}`,
            html
        });

        console.log(`📧 Correo de nota ${nota.folio} enviado correctamente.`);
    } catch (error) {
        console.error("❌ Error al enviar correo:", error.message);
    }
}

module.exports = { enviarCorreoNotaEntrada };5