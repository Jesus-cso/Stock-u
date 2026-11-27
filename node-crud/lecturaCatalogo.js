const verificarToken = require("./verificarToken");

/*
    Permisos para catalogos (proveedores y anaqueles):
    - Roles de almacen: acceso completo.
    - Cualquier otro usuario con sesion: SOLO puede ver la lista (GET /),
      y unicamente los campos indicados (para llenar los <select>).
*/
module.exports = (rolesAlmacen) => {
    const permitidos = rolesAlmacen.map(r => r.toLowerCase());
    const conSesion = verificarToken();

    return (campos) => (req, res, next) => {
        conSesion(req, res, () => {
            const rol = String(req.usuario.rol || "").trim().toLowerCase();
            if (permitidos.includes(rol)) return next();

            if (req.method !== "GET" || req.path !== "/") {
                return res.status(403).json({ error: "No tienes permiso para esta acción." });
            }

            const enviar = res.json.bind(res);
            res.json = (datos) => enviar(Array.isArray(datos)
                ? datos.map(fila => Object.fromEntries(campos.map(c => [c, fila[c]])))
                : datos);
            next();
        });
    };
};