const express = require("express");

const router = express.Router();

/*==================================
    ESCANEOS REMOTOS (celular -> pantallas de escritorio)

    El celular envía el código con POST /escaneos y las pantallas
    de StockDesktop lo recogen con GET /escaneos?desde=<id>.
    Todo vive en memoria: son mensajes de paso, no se guardan en la BD.

    Seguridad opcional: si defines ESCANER_TOKEN en el .env, el POST
    exige el header "x-escaner-token" con ese valor.
===================================*/
const VIDA_MS = 2 * 60 * 1000;   // un escaneo no recogido se descarta a los 2 min
const MAX_HISTORIAL = 50;

let siguienteId = 1;
let escaneos = [];

function limpiar() {
    const limite = Date.now() - VIDA_MS;
    escaneos = escaneos.filter(e => e.ts >= limite).slice(-MAX_HISTORIAL);
}

function validarToken(req, res, next) {
    if (req.usuario) return next(); // ya entró con JWT (PC)
    const token = process.env.ESCANER_TOKEN;
    if (!token) return next();
    if (req.get("x-escaner-token") === token) return next();
    return res.status(401).json({ error: "La clave del scanner es incorrecta." });
}

/*==================================
    RECIBIR UN ESCANEO
    POST /escaneos   body: { "codigo": "7501234567890", "dispositivo": "android" }
===================================*/
router.post("/", validarToken, (req, res) => {
    const codigo = String((req.body && req.body.codigo) ?? "").trim();

    if (!codigo || codigo.length > 50) {
        return res.status(400).json({ error: "Código inválido (vacío o de más de 50 caracteres)." });
    }

    limpiar();

    const registro = {
        id: siguienteId++,
        codigo,
        dispositivo: String((req.body && req.body.dispositivo) || "celular").slice(0, 40),
        ts: Date.now()
    };
    escaneos.push(registro);

    res.status(201).json({ id: registro.id });
});

/*==================================
    CONSULTAR ESCANEOS NUEVOS
    GET /escaneos?desde=<id>
    -> { ultimo: <último id emitido>, escaneos: [ {id, codigo, dispositivo}, ... ] }
===================================*/
router.get("/", (req, res) => {
    limpiar();
    const desde = Number(req.query.desde) || 0;

    res.json({
        ultimo: siguienteId - 1,
        escaneos: escaneos
            .filter(e => e.id > desde)
            .map(({ id, codigo, dispositivo }) => ({ id, codigo, dispositivo }))
    });
});

module.exports = router;