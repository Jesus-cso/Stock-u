process.on("unhandledRejection", (reason) => {
    console.error("PROMESA NO MANEJADA:", reason);
});

process.on("uncaughtException", (error) => {
    console.error("EXCEPCIÓN NO CAPTURADA:", error);
});

const express = require("express");
const cors = require("cors");
require("dotenv").config();

// ---- Variables obligatorias ----
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    console.error("❌ Falta JWT_SECRET en .env (mínimo 32 caracteres).");
    process.exit(1);
}

const verificarToken = require("./middleware/verificarToken");

const app = express();

// ---- CORS: solo orígenes conocidos (puedes ampliar con CORS_ORIGINS=a,b,c en .env) ----
const origenesPermitidos = [
    "https://stockupt.app",          // WebView2 de la app WPF
    "http://localhost:3000",
    "https://localhost:3443",
    ...(process.env.CORS_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean)
];

app.use(cors({
    origin: (origin, callback) => {
        // Sin origin = misma máquina/herramientas (curl, mismo origen)
        if (!origin || origenesPermitidos.includes(origin)) return callback(null, true);
        return callback(new Error("Origen no permitido por CORS"));
    }
}));
app.use(express.json());

// ---- Roles ----
// ROLES_ALMACEN=Admin,Almacenista  (en .env). Si no se define, basta con tener sesión.
const rolesAlmacen = (process.env.ROLES_ALMACEN || "").split(",").map(s => s.trim()).filter(Boolean);

const todos = verificarToken();                 // cualquier usuario con sesión
const soloAlmacen = verificarToken(rolesAlmacen); // personal de almacén

//=====================================
// RUTA PRINCIPAL
//=====================================
app.get("/", (req, res) => {
    res.json({ mensaje: "API Stock funcionando correctamente" });
});

//=====================================
// STATUS (usado por la app WPF para saber si el backend ya arrancó)
//=====================================
app.get("/api/status", (req, res) => {
    res.json({
        estado: "conectado",
        mensaje: "API Stock funcionando correctamente"
    });
});

//=====================================
// RUTAS
//=====================================
// Libre: login y registro
app.use("/auth", require("./auth"));

app.use("/productos", todos, require("./productos"));
app.use("/proveedores", soloAlmacen, require("./proveedores"));
app.use("/anaqueles", soloAlmacen, require("./anaqueles"));
app.use("/miembros", todos, require("./miembros"));
app.use("/crearrouter", soloAlmacen, require("./crearrouter"));
app.use("/notasEntrada", soloAlmacen, require("./notasEntrada"));
app.use("/alertas", todos, require("./alertas"));

// PDF primero para que /Notas/:id/pdf no choque con las otras rutas de /Notas
app.use("/Notas", soloAlmacen, require("./pdfNota"));
app.use("/Notas", soloAlmacen, require("./Notas"));

// Proyectos (líder por número de proyecto)
app.use("/proyectos", todos, require("./proyectos"));
app.use("/prestamos", soloAlmacen, require("./prestamo"));

// Escaneos del celular: se protegen con ESCANER_TOKEN (ver Escaneos.js)
app.use("/escaneos", require("./Escaneos"));

// Scanner en el navegador del celular (pagina + HTTPS local)
const movil = require("./movil");
movil.montar(app);

//=====================================
// MANEJO DE ERRORES
//=====================================
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({
        error: err.message || "Error interno del servidor"
    });
});

//=====================================
// INICIAR SERVIDOR
//=====================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("====================================");
    console.log("Servidor iniciado");
    console.log("http://localhost:" + PORT);
    console.log("====================================");
});

// HTTPS local para que el celular pueda usar la camara (puerto 3443)
movil.iniciarHttps(app);