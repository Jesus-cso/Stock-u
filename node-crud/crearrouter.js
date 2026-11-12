const express = require("express");
const bcrypt = require("bcrypt");
const { sql, getPool } = require("./db");

const router = express.Router();

/*==================================
            REGISTRO
    POST /crearrouter/registro

    body: {
        nombre, apellidos, telefono (opcional),
        numero_control, password,
        codigo_registro        <-- debe coincidir con REGISTRO_CODIGO del .env
    }
===================================*/

router.post("/registro", async (req, res, next) => {

    let transaction;

    try {

        // Solo quien conozca el código puede crear cuentas
        const codigoValido = process.env.REGISTRO_CODIGO;

        if (!codigoValido || req.body.codigo_registro !== codigoValido) {
            return res.status(403).json({
                error: "Código de registro incorrecto."
            });
        }

        const { nombre, apellidos, numero_control, password } = req.body;

        // Evita que .trim() truene con 500 si llega algo que no es texto
        if ([nombre, apellidos, numero_control, password]
            .some(v => typeof v !== "string" || !v.trim())) {
            return res.status(400).json({
                error: "Todos los campos obligatorios deben ser completados."
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                error: "La contraseña debe tener al menos 6 caracteres."
            });
        }

        const nombreCompleto = `${nombre.trim()} ${apellidos.trim()}`;
        const usuarioNombre = numero_control.trim();
        const correoFake = `${usuarioNombre}@vistasstock.com`;

        const pool = await getPool();

        // Verificar si ya existe el usuario
        const checkUser = await pool.request()
            .input("usuario", sql.NVarChar(50), usuarioNombre)
            .query(`
                SELECT id_usuario
                FROM Usuarios
                WHERE usuario = @usuario
            `);

        if (checkUser.recordset.length > 0) {
            return res.status(400).json({
                error: "El número de control ya se encuentra registrado."
            });
        }

        // Encriptar contraseña
        const passwordHash = await bcrypt.hash(password, 10);

        // Usuario + trabajador en una sola transacción: o se crean los dos o ninguno
        transaction = new sql.Transaction(pool);
        await transaction.begin();

        const resultUser = await new sql.Request(transaction)
            .input("nombre", sql.NVarChar(100), nombreCompleto)
            .input("correo", sql.NVarChar(150), correoFake)
            .input("usuario", sql.NVarChar(50), usuarioNombre)
            .input("password_hash", sql.NVarChar(255), passwordHash)
            .input("rol", sql.NVarChar(30), "usuario")
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
                OUTPUT INSERTED.id_usuario
                VALUES
                (
                    @nombre,
                    @correo,
                    @usuario,
                    @password_hash,
                    @rol,
                    1
                )
            `);

        // Registrar trabajador si no existe
        await new sql.Request(transaction)
            .input("matricula", sql.NVarChar(30), usuarioNombre)
            .input("nombre", sql.NVarChar(150), nombreCompleto)
            .query(`
                IF NOT EXISTS
                (
                    SELECT 1
                    FROM Trabajadores
                    WHERE matricula = @matricula
                )
                BEGIN
                    INSERT INTO Trabajadores (matricula, nombre)
                    VALUES (@matricula, @nombre)
                END
            `);

        await transaction.commit();

        res.status(201).json({
            mensaje: "Usuario registrado con éxito.",
            id_usuario: resultUser.recordset[0].id_usuario
        });

    } catch (error) {

        if (transaction) {
            try {
                await transaction.rollback();
            } catch (errorRollback) {
                console.error("❌ Error al hacer rollback:", errorRollback);
            }
        }

        // Dos registros a la vez con el mismo número de control
        if (error.number === 2627 || error.number === 2601) {
            return res.status(400).json({
                error: "El número de control ya se encuentra registrado."
            });
        }

        console.error("Error en registro:", error.message);
        next(error);
    }
});

module.exports = router;