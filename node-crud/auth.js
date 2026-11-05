const express = require("express");
const bcrypt = require("bcrypt");
const { sql, getPool } = require("./db");

const router = express.Router();

// =====================================================
// CREAR CUENTA
// POST /auth/registro
// =====================================================

router.post("/registro", async (req, res, next) => {
    try {
        console.log("📥 Datos recibidos para registro:");
        console.log(req.body);

        const {
            nombre,
            correo,
            usuario,
            password
        } = req.body;

        // =================================================
        // VALIDAR CAMPOS
        // =================================================

        if (!nombre || !correo || !usuario || !password) {
            return res.status(400).json({
                error: "Todos los campos son obligatorios."
            });
        }

        const nombreLimpio = String(nombre).trim();
        const correoLimpio = String(correo).trim();
        const usuarioLimpio = String(usuario).trim();
        const passwordLimpia = String(password);

        if (!nombreLimpio) {
            return res.status(400).json({
                error: "El nombre es obligatorio."
            });
        }

        if (!correoLimpio) {
            return res.status(400).json({
                error: "El correo es obligatorio."
            });
        }

        if (!usuarioLimpio) {
            return res.status(400).json({
                error: "El usuario es obligatorio."
            });
        }

        if (passwordLimpia.length < 6) {
            return res.status(400).json({
                error: "La contraseña debe tener al menos 6 caracteres."
            });
        }

        // =================================================
        // CONECTAR A SQL SERVER
        // =================================================

        const pool = await getPool();

        // =================================================
        // VERIFICAR USUARIO EXISTENTE
        // =================================================

        const existeUsuario = await pool.request()
            .input(
                "usuario",
                sql.NVarChar(50),
                usuarioLimpio
            )
            .query(`
                SELECT id_usuario
                FROM Usuarios
                WHERE usuario = @usuario
            `);

        if (existeUsuario.recordset.length > 0) {
            return res.status(400).json({
                error: "El usuario ya está registrado."
            });
        }

        // =================================================
        // VERIFICAR CORREO EXISTENTE
        // =================================================

        const existeCorreo = await pool.request()
            .input(
                "correo",
                sql.NVarChar(150),
                correoLimpio
            )
            .query(`
                SELECT id_usuario
                FROM Usuarios
                WHERE correo = @correo
            `);

        if (existeCorreo.recordset.length > 0) {
            return res.status(400).json({
                error: "El correo ya está registrado."
            });
        }

        // =================================================
        // GENERAR HASH
        // =================================================

        const passwordHash = await bcrypt.hash(
            passwordLimpia,
            10
        );

        console.log("🔐 Contraseña encriptada correctamente.");

        // =================================================
        // INSERTAR USUARIO
        // =================================================

        const result = await pool.request()
            .input(
                "nombre",
                sql.NVarChar(150),
                nombreLimpio
            )
            .input(
                "correo",
                sql.NVarChar(150),
                correoLimpio
            )
            .input(
                "usuario",
                sql.NVarChar(50),
                usuarioLimpio
            )
            .input(
                "password_hash",
                sql.NVarChar(255),
                passwordHash
            )
            .query(`
                INSERT INTO Usuarios
                (
                    nombre,
                    correo,
                    usuario,
                    password_hash,
                    rol,
                    activo
                )
                OUTPUT
                    INSERTED.id_usuario,
                    INSERTED.nombre,
                    INSERTED.correo,
                    INSERTED.usuario,
                    INSERTED.rol,
                    INSERTED.activo
                VALUES
                (
                    @nombre,
                    @correo,
                    @usuario,
                    @password_hash,
                    'Usuario',
                    1
                )
            `);

        console.log("✅ Usuario insertado correctamente:");
        console.log(result.recordset[0]);

        return res.status(201).json({
            mensaje: "Cuenta creada correctamente.",
            usuario: result.recordset[0]
        });

    } catch (error) {
        console.error("❌ ERROR AL CREAR CUENTA:");
        console.error(error);

        next(error);
    }
});


// =====================================================
// LOGIN
// POST /auth/login
// =====================================================

router.post("/login", async (req, res, next) => {
    try {
        console.log("====================================");
        console.log("📥 PETICIÓN DE LOGIN");
        console.log("Body recibido:", req.body);

        const {
            numcontrol,
            password
        } = req.body;

        // =================================================
        // VALIDAR DATOS
        // =================================================

        if (!numcontrol || !password) {
            console.log("❌ Faltan datos de login");

            return res.status(400).json({
                error: "Número de control y contraseña son obligatorios."
            });
        }

        const usuarioLogin = String(numcontrol).trim();
        const passwordLogin = String(password);

        console.log("Usuario recibido:", usuarioLogin);

        // =================================================
        // CONECTAR A SQL SERVER
        // =================================================

        const pool = await getPool();

        console.log("✅ Pool SQL Server obtenido");

        // =================================================
        // BUSCAR USUARIO
        // =================================================

        const result = await pool.request()
            .input(
                "usuario",
                sql.NVarChar(50),
                usuarioLogin
            )
            .query(`
                SELECT
                    id_usuario,
                    nombre,
                    correo,
                    usuario,
                    password_hash,
                    rol,
                    activo
                FROM Usuarios
                WHERE usuario = @usuario
            `);

        console.log(
            "Resultados encontrados:",
            result.recordset.length
        );

        // =================================================
        // USUARIO NO EXISTE
        // =================================================

        if (result.recordset.length === 0) {
            console.log("❌ Usuario no encontrado");

            return res.status(401).json({
                error: "Número de control o contraseña incorrectos."
            });
        }

        const user = result.recordset[0];

        console.log("✅ Usuario encontrado:", user.usuario);

        // =================================================
        // USUARIO DESACTIVADO
        // =================================================

        if (!user.activo) {
            console.log("❌ Usuario desactivado");

            return res.status(403).json({
                error: "Este usuario está desactivado."
            });
        }

        // =================================================
        // VALIDAR HASH
        // =================================================

        if (!user.password_hash) {
            console.log("❌ El usuario no tiene password_hash");

            return res.status(500).json({
                error: "El usuario no tiene una contraseña configurada."
            });
        }

        // =================================================
        // COMPARAR CONTRASEÑA
        // =================================================

        const passwordValida = await bcrypt.compare(
            passwordLogin,
            user.password_hash
        );

        console.log(
            "¿Password válida?:",
            passwordValida
        );

        if (!passwordValida) {
            console.log("❌ Contraseña incorrecta");

            return res.status(401).json({
                error: "Número de control o contraseña incorrectos."
            });
        }

        // =================================================
        // LOGIN CORRECTO
        // =================================================

        console.log(
            "✅ LOGIN EXITOSO:",
            user.usuario
        );

        console.log("====================================");

        return res.status(200).json({
            mensaje: "Login exitoso",
            usuario: {
                id_usuario: user.id_usuario,
                nombre: user.nombre,
                correo: user.correo,
                usuario: user.usuario,
                rol: user.rol
            }
        });

    } catch (error) {
        console.error("====================================");
        console.error("❌ ERROR EN LOGIN:");
        console.error(error);
        console.error("====================================");

        next(error);
    }
});


// =====================================================
// EXPORTAR ROUTER
// =====================================================

module.exports = router;