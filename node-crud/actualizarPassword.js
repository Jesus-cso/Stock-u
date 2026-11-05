const bcrypt = require("bcrypt");
const { sql, getPool } = require("./db");

async function actualizar() {
    const numeroControl = "20231001";
    const passwordEnTexto = "123456";

    const hash = await bcrypt.hash(passwordEnTexto, 10);

    const pool = await getPool();

    await pool.request()
        .input("usuario", sql.NVarChar(50), numeroControl)
        .input("hash", sql.NVarChar(255), hash)
        .query(`
            UPDATE Usuarios
            SET password_hash = @hash
            WHERE usuario = @usuario
        `);

    console.log("✅ Contraseña actualizada correctamente para el usuario:", numeroControl);
    process.exit(0);
}

actualizar().catch(err => {
    console.error("❌ Error:", err.message);
    process.exit(1);
});