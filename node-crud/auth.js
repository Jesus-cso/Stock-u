const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { sql, getPool } = require("./db");

const router = express.Router();

// =====================================================
// CREAR CUENTA
// POST /auth/registro
// =====================================================

router.post("/registro", async (req, res, next) => {
    try {
        const { nombre, correo, usuario, password } = req.body;

        if (!nombre || !correo || !usuario || !password) {
            return res.status(400).json({ error: "Todos los campos son obligatorios." });
        }

        const nombreLimpio = String(nombre).trim();
        const correoLimpio = String(correo).trim();
        const usuarioLimpio = String(usuario).trim();
        const passwordLimpia = String(password);

        if (!nombreLimpio) {
            return res.status(400).json({ error: "El nombre es obligatorio." });
        }
        if (!correoLimpio) {
            return res.status(400).json({ error: "El correo es obligatorio." });
        }
        if (!usuarioLimpio) {
            return res.status(400).json({ error: "El usuario es obligatorio." });
        }
        if (passwordLimpia.length < 6) {
            return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres." });
        }

        const pool = await getPool();

        const existeUsuario = await pool.request()
            .input("usuario", sql.NVarChar(50), usuarioLimpio)
            .query(`SELECT id_usuario FROM Usuarios WHERE usuario = @usuario`);

        if (existeUsuario.recordset.length > 0) {
            return res.status(400).json({ error: "El usuario ya está registrado." });
        }

        const existeCorreo = await pool.request()
            .input("correo", sql.NVarChar(150), correoLimpio)
            .query(`SELECT id_usuario FROM Usuarios WHERE correo = @correo`);

        if (existeCorreo.recordset.length > 0) {
            return res.status(400).json({ error: "El correo ya está registrado." });
        }

        const passwordHash = await bcrypt.hash(passwordLimpia, 10);

        const result = await pool.request()
            .input("nombre", sql.NVarChar(150), nombreLimpio)
            .input("correo", sql.NVarChar(150), correoLimpio)
            .input("usuario", sql.NVarChar(50), usuarioLimpio)
            .input("password_hash", sql.NVarChar(255), passwordHash)
            .query(`
                INSERT INTO Usuarios (nombre, correo, usuario, password_hash, rol, activo)
                OUTPUT
                    INSERTED.id_usuario,
                    INSERTED.nombre,
                    INSERTED.correo,
                    INSERTED.usuario,
                    INSERTED.rol,
                    INSERTED.activo
                VALUES (@nombre, @correo, @usuario, @password_hash, 'Usuario', 1)
            `);

        return res.status(201).json({
            mensaje: "Cuenta creada correctamente.",
            usuario: result.recordset[0]
        });

    } catch (error) {
        console.error("❌ ERROR AL CREAR CUENTA:", error.message);
        next(error);
    }
});


// =====================================================
// LOGIN
// POST /auth/login
// Devuelve un token JWT que el front debe mandar en
// el header  Authorization: Bearer <token>
// =====================================================

router.post("/login", async (req, res, next) => {
    try {
        const { numcontrol, password } = req.body;

        if (!numcontrol || !password) {
            return res.status(400).json({
                error: "Número de control y contraseña son obligatorios."
            });
        }

        const usuarioLogin = String(numcontrol).trim();
        const passwordLogin = String(password);

        const pool = await getPool();

        const result = await pool.request()
            .input("usuario", sql.NVarChar(50), usuarioLogin)
            .query(`
                SELECT id_usuario, nombre, correo, usuario, password_hash, rol, activo
                FROM Usuarios
                WHERE usuario = @usuario
            `);

        if (result.recordset.length === 0) {
            return res.status(401).json({
                error: "Número de control o contraseña incorrectos."
            });
        }

        const user = result.recordset[0];

        if (!user.activo) {
            return res.status(403).json({ error: "Este usuario está desactivado." });
        }

        if (!user.password_hash) {
            return res.status(500).json({
                error: "El usuario no tiene una contraseña configurada."
            });
        }

        const passwordValida = await bcrypt.compare(passwordLogin, user.password_hash);

        if (!passwordValida) {
            return res.status(401).json({
                error: "Número de control o contraseña incorrectos."
            });
        }

        const token = jwt.sign(
            {
                id_usuario: user.id_usuario,
                usuario: user.usuario,
                nombre: user.nombre,
                rol: user.rol
            },
            process.env.JWT_SECRET,
            { expiresIn: "8h" }
        );

        return res.status(200).json({
            mensaje: "Login exitoso",
            token,
            usuario: {
                id_usuario: user.id_usuario,
                nombre: user.nombre,
                correo: user.correo,
                usuario: user.usuario,
                rol: user.rol
            }
        });

    } catch (error) {
        console.error("❌ ERROR EN LOGIN:", error.message);
        next(error);
    }
});

module.exports = router;