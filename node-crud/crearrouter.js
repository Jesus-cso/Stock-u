const express = require("express");
const bcrypt = require("bcrypt");
const { sql, getPool } = require("./db");

const router = express.Router();

/*==================================
            REGISTRO
===================================*/

router.post("/registro", async (req, res, next) => {
    try {

        const {
            nombre,
            apellidos,
            telefono,
            numero_control,
            password
        } = req.body;

        // Validar campos obligatorios
        if (!nombre || !apellidos || !numero_control || !password) {
            return res.status(400).json({
                error: "Todos los campos obligatorios deben ser completados."
            });
        }

        const pool = await getPool();

        const nombreCompleto = `${nombre.trim()} ${apellidos.trim()}`;
        const usuarioNombre = numero_control.trim();
        const correoFake = `${usuarioNombre}@vistasstock.com`;

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
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        // Insertar usuario
        const resultUser = await pool.request()
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
                    rol
                )

                OUTPUT INSERTED.id_usuario

                VALUES
                (
                    @nombre,
                    @correo,
                    @usuario,
                    @password_hash,
                    @rol
                )
            `);

        // Registrar trabajador si no existe
        await pool.request()
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
                    INSERT INTO Trabajadores
                    (
                        matricula,
                        nombre
                    )
                    VALUES
                    (
                        @matricula,
                        @nombre
                    )
                END
            `);

        res.status(201).json({
            mensaje: "Usuario registrado con éxito.",
            id_usuario: resultUser.recordset[0].id_usuario
        });
        
    } catch (error) {
        console.error("Error en registro:", error);
        next(error);
    }
});

module.exports = router;