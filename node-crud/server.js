require("dotenv").config();

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

process.on("unhandledRejection", (reason) => {
    console.error("PROMESA NO MANEJADA:", reason);
});

process.on("uncaughtException", (error) => {
    console.error("EXCEPCION NO CAPTURADA:", error);
    process.exit(1);
});

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
    console.warn("JWT_SECRET no valido: se genero uno temporal.");
}

const esProduccion = process.env.NODE_ENV === "production";

const rolesAlmacen = (process.env.ROLES_ALMACEN || "Admin,Almacenista")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

if (rolesAlmacen.length === 0) {
    console.error("ROLES_ALMACEN no tiene ningun rol valido.");
    process.exit(1);
}

const verificarToken = require("./verificarToken");
const todos = verificarToken();
const soloAlmacen = verificarToken(rolesAlmacen);
const lecturaCatalogo = require("./lecturaCatalogo")(rolesAlmacen);

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
    return todos(req, res, next);
}

const app = express();

if (process.env.RENDER) {
    app.set("trust proxy", 1);
}

const origenesPermitidos = [
    "https://stockupt.app",
    "http://localhost:3000",
    "https://localhost:3443",
    process.env.RENDER_EXTERNAL_URL,
    ...(process.env.CORS_ORIGINS || "").split(",").map(s => s.trim())
].filter(Boolean);

const redLocal = /^https?:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/;

function origenPermitido(origin) {
    if (!origin) return true;
    if (origenesPermitidos.includes(origin)) return true;
    if (!esProduccion && redLocal.test(origin)) return true;
    return false;
}

app.use(cors({
    origin: (origin, callback) => {
        if (origenPermitido(origin)) return callback(null, true);
        return callback(new Error("Origen no permitido por CORS"));
    }
}));

app.use(express.json({ limit: "1mb" }));

app.use((req, res, next) => {
    if (req.url.startsWith("/api/") && !req.url.startsWith("/api/status")) {
        req.url = req.url.slice(4);
    }
    next();
});

const carpetaWeb = path.join(__dirname, "..", "wwwroot");

// Resolver archivos HTML sin importar mayusculas, minusculas o si falta .html
app.use((req, res, next) => {
    // Solo cuando el navegador pide una PAGINA. Los fetch (/anaqueles, /alertas)
    // deben llegar a la API y no al archivo .html del mismo nombre.
    if (req.method !== "GET" || !(req.get("accept") || "").includes("text/html")) return next();
    const rutaLimpia = decodeURIComponent(req.path).replace(/^\/+/, "");
    if (!rutaLimpia) return next();

    try {
        const archivos = fs.readdirSync(carpetaWeb);
        const encontrado = archivos.find(f =>
            f.toLowerCase() === rutaLimpia.toLowerCase() ||
            f.toLowerCase() === (rutaLimpia + ".html").toLowerCase()
        );
        if (encontrado && encontrado.toLowerCase().endsWith(".html")) {
            return res.sendFile(path.join(carpetaWeb, encontrado));
        }
    } catch (e) {}
    next();
});

app.use(express.static(carpetaWeb));

app.get("/", (req, res) => {
    res.sendFile(path.join(carpetaWeb, "index.html"));
});

app.get("/api/status", (req, res) => {
    res.json({
        estado: "conectado",
        mensaje: "API Stock funcionando correctamente"
    });
});

const limitadorAuth = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Demasiados intentos, intenta mas tarde" }
});

app.use("/auth", limitadorAuth, require("./auth"));
app.use("/crearrouter", limitadorAuth, require("./crearrouter"));

app.use("/productos", todos, require("./productos"));
app.use("/miembros", todos, require("./miembros"));
app.use("/alertas", todos, require("./alertas"));
app.use("/proyectos", todos, require("./proyectos"));
app.use("/escaneos", jwtOClaveEscaner, require("./Escaneos"));

app.use("/proveedores", lecturaCatalogo(["id_proveedor", "nombre"]), require("./proveedores"));
app.use("/anaqueles", lecturaCatalogo(["id_anaquel", "codigo"]), require("./anaqueles"));
app.use("/historial", soloAlmacen, require("./Historial"));
app.use("/notasEntrada", soloAlmacen, require("./notasEntrada"));
app.use("/prestamos", soloAlmacen, require("./prestamo"));
app.use("/Notas", soloAlmacen, require("./pdfNota"), require("./Notas"));

const movil = require("./movil");
movil.montar(app);

app.use((req, res) => {
    res.status(404).json({ error: "Ruta no encontrada" });
});

app.use((err, req, res, next) => {
    console.error("ERROR DEL SERVIDOR:", err);
    if (res.headersSent) return next(err);

    const esCors = err.message === "Origen no permitido por CORS";
    const status = esCors ? 403 : (err.status || 500);

    res.status(status).json({
        error: (esCors || !esProduccion || status < 500)
            ? err.message
            : "Error interno del servidor"
    });
});

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
        console.error(`El puerto ${PORT} ya esta en uso.`);
    } else {
        console.error("Error al iniciar el servidor:", err);
    }
    process.exit(1);
});

["SIGINT", "SIGTERM"].forEach(signal => {
    process.on(signal, () => {
        console.log(`\n${signal} recibido, cerrando servidor...`);
        servidor.close(() => process.exit(0));
    });
});

if (!process.env.RENDER) {
    movil.iniciarHttps(app);
}