// =====================================
// IMPORTACIONES
// =====================================

require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit"); // npm i express-rate-limit

// =====================================
// MANEJO DE ERRORES GLOBALES
// =====================================

process.on("unhandledRejection", (reason) => {
    console.error("PROMESA NO MANEJADA:", reason);
});

process.on("uncaughtException", (error) => {
    console.error("EXCEPCIÓN NO CAPTURADA:", error);
    // El proceso queda en estado inconsistente: salir y dejar que PM2/systemd lo reinicie
    process.exit(1);
});

// =====================================
// VALIDAR VARIABLES
// =====================================

// Si falta JWT_SECRET (o es muy corto) se genera uno temporal.
// OJO: cambia en cada reinicio y cierra todas las sesiones.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
    console.warn("⚠️ JWT_SECRET no válido: se generó uno temporal.");
}

const esProduccion = process.env.NODE_ENV === "production";

const rolesAlmacen = (process.env.ROLES_ALMACEN || "Admin,Almacenista")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

if (rolesAlmacen.length === 0) {
    console.error("❌ ROLES_ALMACEN no tiene ningún rol válido.");
    process.exit(1);
}

// =====================================
// MIDDLEWARE JWT
// =====================================

const verificarToken = require("./verificarToken");

const todos = verificarToken();                   // cualquier usuario autenticado
const soloAlmacen = verificarToken(rolesAlmacen); // personal de almacén

// /escaneos lo usan dos clientes distintos:
//  - la PC (pantallas de escritorio): entra con su JWT (Authorization: Bearer ...)
//  - el celular (movil.html / app Expo): no tiene sesión, entra con la clave
//    del scanner en el header "x-escaner-token" (= ESCANER_TOKEN del .env)
function claveEscanerValida(req) {
    const esperada = process.env.ESCANER_TOKEN || "";
    const recibida = req.get("x-escaner-token") || "";
    if (!esperada || !recibida) return false;
    const a = Buffer.from(recibida);
    const b = Buffer.from(esperada);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function jwtOClaveEscaner(req, res, next) {
    if (claveEscanerValida(req)) return next();
    return todos(req, res, next); // si no hay clave válida, se exige el JWT
}

// =====================================
// CREAR APLICACIÓN
// =====================================

const app = express();

// Render pone un proxy delante: necesario para que el límite de intentos
// distinga la IP de cada cliente
if (process.env.RENDER) {
    app.set("trust proxy", 1);
}

// =====================================
// CORS
// =====================================

const origenesPermitidos = [
    "https://stockupt.app",
    "http://localhost:3000",
    "https://localhost:3443",
    process.env.RENDER_EXTERNAL_URL, // Render la define automáticamente
    ...(process.env.CORS_ORIGINS || "")
        .split(",")
        .map(s => s.trim())
]
    .filter(Boolean);

// En desarrollo se aceptan origenes de la red local (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
// para que el escáner móvil funcione sin tocar el .env cada vez que cambie la IP.
const redLocal = /^https?:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/;

function origenPermitido(origin) {
    if (!origin) return true; // Postman/curl o apps móviles sin Origin
    if (origenesPermitidos.includes(origin)) return true;
    if (!esProduccion && redLocal.test(origin)) return true;
    return false;
}

app.use(cors({
    origin: (origin, callback) => {
        if (origenPermitido(origin)) {
            return callback(null, true);
        }
        return callback(new Error("Origen no permitido por CORS"));
    }
}));

app.use(express.json({ limit: "1mb" }));

// =====================================
// COMPATIBILIDAD CON PREFIJO /api
// =====================================
// Permite llamar tanto /productos como /api/productos.
// /api/status se deja intacto porque tiene su propia ruta.

app.use((req, res, next) => {
    if (req.url.startsWith("/api/") && !req.url.startsWith("/api/status")) {
        req.url = req.url.slice(4);
    }
    next();
});

// =====================================
// RUTAS PÚBLICAS
// =====================================

app.get("/", (req, res) => {
    res.json({ mensaje: "API Stock funcionando correctamente" });
});

app.get("/api/status", (req, res) => {
    res.json({
        estado: "conectado",
        mensaje: "API Stock funcionando correctamente"
    });
});

// Límite de intentos para evitar fuerza bruta en el login
const limitadorAuth = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Demasiados intentos, intenta más tarde" }
});

app.use("/auth", limitadorAuth, require("./auth"));

// =====================================
// RUTAS PARA TODOS LOS USUARIOS AUTENTICADOS
// =====================================

app.use("/productos", todos, require("./productos"));
app.use("/miembros", todos, require("./miembros"));
app.use("/alertas", todos, require("./alertas"));
app.use("/proyectos", todos, require("./proyectos"));
app.use("/escaneos", jwtOClaveEscaner, require("./Escaneos"));

// =====================================
// RUTAS SOLO PERSONAL DE ALMACÉN
// =====================================

app.use("/proveedores", soloAlmacen, require("./proveedores"));
app.use("/anaqueles", soloAlmacen, require("./anaqueles"));
app.use("/crearrouter", soloAlmacen, require("./crearrouter"));
app.use("/notasEntrada", soloAlmacen, require("./notasEntrada"));
app.use("/prestamos", soloAlmacen, require("./prestamo"));

// Un solo montaje para /Notas con ambos routers
app.use("/Notas", soloAlmacen, require("./pdfNota"), require("./Notas"));

// =====================================
// ESCÁNER MÓVIL
// =====================================

const movil = require("./movil");
movil.montar(app);

// =====================================
// 404 (siempre después de todas las rutas)
// =====================================

app.use((req, res) => {
    res.status(404).json({ error: "Ruta no encontrada" });
});

// =====================================
// MANEJO DE ERRORES
// =====================================

app.use((err, req, res, next) => {
    console.error("ERROR DEL SERVIDOR:", err);

    if (res.headersSent) {
        return next(err);
    }

    const esCors = err.message === "Origen no permitido por CORS";
    const status = esCors ? 403 : (err.status || 500);

    res.status(status).json({
        // En producción no se expone el detalle de errores internos
        error: (esCors || !esProduccion || status < 500)
            ? err.message
            : "Error interno del servidor"
    });
});

// =====================================
// INICIAR SERVIDOR HTTP
// =====================================

const PORT = process.env.PORT || 3000;

const servidor = app.listen(PORT, () => {
    console.log("====================================");
    console.log("       STOCKUP INICIADO");
    console.log("====================================");
    console.log("Servidor: http://localhost:" + PORT);
    console.log("Estado: FUNCIONANDO");
    console.log("====================================");
});

servidor.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
        console.error(`❌ El puerto ${PORT} ya está en uso.`);
    } else {
        console.error("❌ Error al iniciar el servidor:", err);
    }
    process.exit(1);
});

// Cierre ordenado
["SIGINT", "SIGTERM"].forEach(señal => {
    process.on(señal, () => {
        console.log(`\n${señal} recibido, cerrando servidor...`);
        servidor.close(() => process.exit(0));
    });
});

// =====================================
// HTTPS LOCAL PARA ESCÁNER
// =====================================

// En Render el HTTPS ya lo pone la plataforma
if (!process.env.RENDER) {
    movil.iniciarHttps(app);
}