const jwt = require("jsonwebtoken");

/*
    verificarToken()                    -> basta con tener sesión
    verificarToken(["Admin", "Almacen"]) -> además el rol debe estar en la lista
    (la comparación de roles no distingue mayúsculas/minúsculas)
*/
function verificarToken(rolesPermitidos = []) {
    const permitidos = rolesPermitidos.map(r => String(r).toLowerCase());

    return (req, res, next) => {
        const header = req.get("Authorization") || "";
        const token = header.startsWith("Bearer ") ? header.slice(7) : null;

        if (!token) {
            return res.status(401).json({ error: "Inicia sesión para continuar." });
        }

        try {
            const datos = jwt.verify(token, process.env.JWT_SECRET);
            req.usuario = datos; // { id_usuario, usuario, nombre, rol }

            if (permitidos.length > 0 && !permitidos.includes(String(datos.rol).toLowerCase())) {
                return res.status(403).json({ error: "No tienes permiso para esta acción." });
            }
            next();
        } catch (e) {
            return res.status(401).json({ error: "Sesión inválida o vencida." });
        }
    };
}

module.exports = verificarToken;