// =====================================
// IMPORTACIONES
// =====================================

require("dotenv").config();

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

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    console.error("❌ JWT_SECRET debe tener mínimo 32 caracteres.");
    process.exit(1);
}

const esProduccion = process.env.NODE_ENV === "production";

const rolesAlmacen = (process.env.ROLES_ALMACEN || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

if (rolesAlmacen.length === 0) {
    console.error("❌ ROLES_ALMACEN no está definido en el .env.");
    process.exit(1);
}

// =====================================
// MIDDLEWARE JWT
// =====================================

const verificarToken = require("./verificarToken");

const todos = verificarToken();               // cualquier usuario autenticado
const soloAlmacen = verificarToken(rolesAlmacen); // personal de almacén

// =====================================
// CREAR APLICACIÓN
// =====================================

const app = express();

// =====================================
// CORS
// =====================================

const origenesPermitidos = [
    "https://stockupt.app",
    "http://localhost:3000",
    "https://localhost:3443",
    ...(process.env.CORS_ORIGINS || "")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean)
];

app.use(cors({
    origin: (origin, callback) => {
        // Sin origin = herramientas como Postman/curl o apps móviles
        if (!origin || origenesPermitidos.includes(origin)) {
            return callback(null, true);
        }
        return callback(new Error("Origen no permitido por CORS"));
    }
}));

app.use(express.json({ limit: "1mb" }));

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
app.use("/escaneos", todos, require("./Escaneos")); // ← antes sin autenticación

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
// 404
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

movil.iniciarHttps(app);