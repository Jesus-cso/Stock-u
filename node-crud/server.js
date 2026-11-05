process.on("unhandledRejection", (reason) => {
    console.error("PROMESA NO MANEJADA:", reason);
});

process.on("uncaughtException", (error) => {
    console.error("EXCEPCIÓN NO CAPTURADA:", error);
});

const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

//=====================================
// RUTA PRINCIPAL
//=====================================
app.get("/", (req, res) => {
    res.json({
        mensaje: "API Stock funcionando correctamente"
    });
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
const productosRouter = require("./productos");
console.log("Productos:", typeof productosRouter);
app.use("/productos", productosRouter);

const proveedoresRouter = require("./proveedores");
console.log("Proveedores:", typeof proveedoresRouter);
app.use("/proveedores", proveedoresRouter);

const anaquelesRouter = require("./anaqueles");
console.log("Anaqueles:", typeof anaquelesRouter);
app.use("/anaqueles", anaquelesRouter);

const miembrosRouter = require("./miembros");
console.log("Miembros:", typeof miembrosRouter);
app.use("/miembros", miembrosRouter);

const authRouter = require("./auth");
console.log("Auth:", typeof authRouter);
app.use("/auth", authRouter);

const crearRouter = require("./crearrouter");
console.log("CrearRouter:", typeof crearRouter);
app.use("/crearrouter", crearRouter);

const notasEntradaRouter = require("./notasEntrada");
console.log("NotasEntrada:", typeof notasEntradaRouter);
app.use("/notasEntrada", notasEntradaRouter);

const alertasRouter = require("./alertas");
console.log("Alertas:", typeof alertasRouter);
app.use("/alertas", alertasRouter);

const notasSalidaRouter = require("./Notas");
console.log("NotasSalida:", typeof notasSalidaRouter);
app.use("/Notas", notasSalidaRouter);

// Proyectos (líder por número de proyecto)
const proyectosRouter = require("./proyectos");
console.log("Proyectos:", typeof proyectosRouter);
app.use("/proyectos", proyectosRouter);

const prestamosRouter = require("./prestamo");
console.log("Prestamos:", typeof prestamosRouter);
app.use("/prestamos", prestamosRouter);

const escaneosRouter = require("./escaneos");
app.use("/escaneos", escaneosRouter);

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