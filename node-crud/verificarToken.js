
const jwt = require("jsonwebtoken");

/*
    verificarToken()
    Permite el acceso a cualquier usuario autenticado.

    verificarToken(["Admin", "Almacenista"])
    Permite solamente los roles indicados.

    La comparación de roles no distingue mayúsculas
    ni minúsculas.
*/

function verificarToken(rolesPermitidos = []) {

    const permitidos = rolesPermitidos.map(
        rol => String(rol).trim().toLowerCase()
    );

    return (req, res, next) => {

        const header = req.get("Authorization") || "";

        const token = header.startsWith("Bearer ")
            ? header.slice(7).trim()
            : null;

        // Verificar que exista el token
        if (!token) {
            return res.status(401).json({
                error: "Inicia sesión para continuar."
            });
        }

        try {

            // Validar JWT
            const datos = jwt.verify(
                token,
                process.env.JWT_SECRET
            );

            // Guardar información del usuario
            req.usuario = datos;

            // Verificar permisos por rol
            if (
                permitidos.length > 0 &&
                !permitidos.includes(
                    String(datos.rol || "").trim().toLowerCase()
                )
            ) {
                return res.status(403).json({
                    error: "No tienes permiso para esta acción."
                });
            }

            next();

        } catch (error) {

            console.error("Error JWT:", error.message);

            return res.status(401).json({
                error: "Sesión inválida o vencida."
            });
        }
    };
}

module.exports = verificarToken;
