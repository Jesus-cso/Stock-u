const express = require("express");
const { sql, getPool } = require("./db");

const router = express.Router();

// Middleware de validación para IDs
function validarId(id) {
    const idNum = parseInt(id);
    if (isNaN(idNum) || idNum <= 0) {
        throw Object.assign(new Error('ID de proveedor inválido'), { status: 400 });
    }
    return idNum;
}

// Middleware de validación para datos del proveedor
function validarProveedor(data) {
    if (!data.nombre || data.nombre.trim() === '') {
        throw Object.assign(new Error('El nombre del proveedor es obligatorio'), { status: 400 });
    }
    return {
        nombre: data.nombre.trim(),
        contacto: data.contacto ? data.contacto.trim() : null,
        telefono: data.telefono ? data.telefono.trim() : null,
        correo: data.correo ? data.correo.trim() : null,
        direccion: data.direccion ? data.direccion.trim() : null
    };
}

/*=====================================
        OBTENER TODOS LOS PROVEEDORES
=====================================*/
router.get("/", async (req, res, next) => {
    try {
        const pool = await getPool();

        const result = await pool.request().query(`
            SELECT
                id_proveedor,
                nombre,
                contacto,
                telefono,
                correo,
                direccion,
                fecha_registro
            FROM Proveedores
            ORDER BY nombre
        `);

        res.json(result.recordset);

    } catch (error) {
        console.error('❌ Error en GET /proveedores:', error);
        next(error);
    }
});

/*=====================================
        OBTENER UN PROVEEDOR POR ID
=====================================*/
router.get("/:id", async (req, res, next) => {
    try {
        const id = validarId(req.params.id);
        const pool = await getPool();

        const result = await pool.request()
            .input("id", sql.Int, id)
            .query(`
                SELECT
                    id_proveedor,
                    nombre,
                    contacto,
                    telefono,
                    correo,
                    direccion,
                    fecha_registro
                FROM Proveedores
                WHERE id_proveedor = @id
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                error: 'Proveedor no encontrado'
            });
        }

        res.json(result.recordset[0]);

    } catch (error) {
        console.error('❌ Error en GET /proveedores/:id:', error);
        next(error);
    }
});

/*=====================================
        CREAR PROVEEDOR
=====================================*/
router.post("/", async (req, res, next) => {
    try {
        // Validar datos
        const datos = validarProveedor(req.body);

        const pool = await getPool();

        // Verificar si ya existe un proveedor con el mismo nombre
        const checkResult = await pool.request()
            .input("nombre", sql.NVarChar(100), datos.nombre)
            .query(`
                SELECT id_proveedor 
                FROM Proveedores 
                WHERE LOWER(nombre) = LOWER(@nombre)
            `);

        if (checkResult.recordset.length > 0) {
            return res.status(409).json({
                error: 'Ya existe un proveedor con este nombre'
            });
        }

        // Insertar nuevo proveedor
        const result = await pool.request()
            .input("nombre", sql.NVarChar(100), datos.nombre)
            .input("contacto", sql.NVarChar(100), datos.contacto)
            .input("telefono", sql.NVarChar(20), datos.telefono)
            .input("correo", sql.NVarChar(100), datos.correo)
            .input("direccion", sql.NVarChar(200), datos.direccion)
            .query(`
                INSERT INTO Proveedores
                (
                    nombre,
                    contacto,
                    telefono,
                    correo,
                    direccion
                )
                VALUES
                (
                    @nombre,
                    @contacto,
                    @telefono,
                    @correo,
                    @direccion
                )
                RETURNING id_proveedor
            `);

        const nuevoProveedor = {
            id_proveedor: result.recordset[0].id_proveedor,
            ...datos,
            fecha_registro: new Date().toISOString()
        };

        res.status(201).json({
            mensaje: "Proveedor creado correctamente",
            proveedor: nuevoProveedor
        });

    } catch (error) {
        console.error('❌ Error en POST /proveedores:', error);
        next(error);
    }
});

/*=====================================
        ACTUALIZAR PROVEEDOR
=====================================*/
router.put("/:id", async (req, res, next) => {
    try {
        const id = validarId(req.params.id);
        const datos = validarProveedor(req.body);

        const pool = await getPool();

        // Verificar si el proveedor existe
        const checkResult = await pool.request()
            .input("id", sql.Int, id)
            .query(`
                SELECT id_proveedor 
                FROM Proveedores 
                WHERE id_proveedor = @id
            `);

        if (checkResult.recordset.length === 0) {
            return res.status(404).json({
                error: 'Proveedor no encontrado'
            });
        }

        // Verificar si el nombre ya está en uso por otro proveedor
        const nameCheck = await pool.request()
            .input("nombre", sql.NVarChar(100), datos.nombre)
            .input("id", sql.Int, id)
            .query(`
                SELECT id_proveedor 
                FROM Proveedores 
                WHERE LOWER(nombre) = LOWER(@nombre) AND id_proveedor != @id
            `);

        if (nameCheck.recordset.length > 0) {
            return res.status(409).json({
                error: 'Ya existe otro proveedor con este nombre'
            });
        }

        // Actualizar proveedor
        const result = await pool.request()
            .input("id", sql.Int, id)
            .input("nombre", sql.NVarChar(100), datos.nombre)
            .input("contacto", sql.NVarChar(100), datos.contacto)
            .input("telefono", sql.NVarChar(20), datos.telefono)
            .input("correo", sql.NVarChar(100), datos.correo)
            .input("direccion", sql.NVarChar(200), datos.direccion)
            .query(`
                UPDATE Proveedores
                SET
                    nombre = @nombre,
                    contacto = @contacto,
                    telefono = @telefono,
                    correo = @correo,
                    direccion = @direccion
                WHERE id_proveedor = @id
            `);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                error: 'Proveedor no encontrado'
            });
        }

        res.json({
            mensaje: "Proveedor actualizado correctamente",
            proveedor: {
                id_proveedor: id,
                ...datos
            }
        });

    } catch (error) {
        console.error('❌ Error en PUT /proveedores/:id:', error);
        next(error);
    }
});

/*=====================================
        ELIMINAR PROVEEDOR
=====================================*/
router.delete("/:id", async (req, res, next) => {
    try {
        const id = validarId(req.params.id);
        const pool = await getPool();

        // Verificar si el proveedor existe
        const checkResult = await pool.request()
            .input("id", sql.Int, id)
            .query(`
                SELECT id_proveedor 
                FROM Proveedores 
                WHERE id_proveedor = @id
            `);

        if (checkResult.recordset.length === 0) {
            return res.status(404).json({
                error: 'Proveedor no encontrado'
            });
        }

        // Verificar si el proveedor tiene productos asociados
        const productCheck = await pool.request()
            .input("id", sql.Int, id)
            .query(`
                SELECT COUNT(*) as total
                FROM Productos
                WHERE id_proveedor = @id
            `);

        if (productCheck.recordset[0].total > 0) {
            return res.status(409).json({
                error: 'No se puede eliminar el proveedor porque tiene productos asociados'
            });
        }

        // Eliminar proveedor
        const result = await pool.request()
            .input("id", sql.Int, id)
            .query(`
                DELETE FROM Proveedores
                WHERE id_proveedor = @id
            `);

        res.json({
            mensaje: "Proveedor eliminado correctamente",
            id_eliminado: id
        });

    } catch (error) {
        console.error('❌ Error en DELETE /proveedores/:id:', error);
        next(error);
    }
});

/*=====================================
        BUSCAR PROVEEDORES
=====================================*/
router.get("/buscar/:termino", async (req, res, next) => {
    try {
        const termino = req.params.termino;
        const pool = await getPool();

        const result = await pool.request()
            .input("termino", sql.NVarChar(100), `%${termino}%`)
            .query(`
                     SELECT
                    id_proveedor,
                    nombre,
                    contacto,
                    telefono,
                    correo,
                    direccion,
                    fecha_registro
                FROM Proveedores
                WHERE 
                    nombre ILIKE @termino OR
                    contacto ILIKE @termino OR
                    telefono ILIKE @termino OR
                    correo ILIKE @termino
                ORDER BY nombre
            `);

        res.json(result.recordset);

    } catch (error) {
        console.error('❌ Error en GET /proveedores/buscar/:termino:', error);
        next(error);
    }
});

module.exports = router;