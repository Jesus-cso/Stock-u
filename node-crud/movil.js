/*==================================
    SCANNER EN EL NAVEGADOR DEL CELULAR (todo local, sin internet)

    - Sirve  /movil.html  y  /movil/*  (solo esos archivos, no todo wwwroot).
    - GET /conectar-celular  (solo desde la propia PC) devuelve la(s) URL(s)
      https://<IP-de-la-PC>:3443/movil.html para armar el QR.
    - Abre un segundo servidor HTTPS (puerto 3443) con certificado propio,
      porque el navegador del celular solo deja usar la cámara en https.
      El certificado se crea la primera vez en node-crud/certs/.

    Los escaneos que manda la página van al mismo POST /escaneos que usa la
    app de Expo, así que las pantallas de escritorio no cambian.
===================================*/
const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");
const crypto = require("crypto");
const express = require("express");

const PUERTO_HTTPS = Number(process.env.HTTPS_PORT) || 3443;
const DIR_CERTS = path.join(__dirname, "certs");

// Estado visible para /conectar-celular
const estado = { httpsListo: false, motivo: "El servidor HTTPS todavía no arranca." };

/*----------------------------------
    Carpeta wwwroot (junto a node-crud o dentro de él)
----------------------------------*/
function carpetaWww() {
    const candidatas = [
        path.join(__dirname, "..", "wwwroot"),
        path.join(__dirname, "wwwroot")
    ];
    return candidatas.find(p => fs.existsSync(path.join(p, "movil.html"))) || candidatas[0];
}

/*----------------------------------
    IPs de la PC que el celular podría alcanzar.
    Se descartan adaptadores virtuales (VirtualBox, WSL, Hyper-V, Docker…)
    y se ordena: Wi-Fi, punto de acceso móvil (192.168.137.1), Ethernet, otros.
----------------------------------*/
const VIRTUAL = /virtual|vbox|vmware|vethernet|wsl|hyper-v|docker|loopback|bluetooth|tailscale|zerotier|vpn|tap|tun/i;
const WIFI = /wi-?fi|wlan|inal[aá]mbric|wireless/i;

function ipsDeLaPc() {
    const lista = [];
    const interfaces = os.networkInterfaces();

    for (const nombre of Object.keys(interfaces)) {
        for (const dir of interfaces[nombre] || []) {
            if (dir.family !== "IPv4" || dir.internal) continue;
            if (dir.address.startsWith("169.254.")) continue;      // sin DHCP
            if (VIRTUAL.test(nombre)) continue;
            if (dir.address.startsWith("192.168.56.")) continue;   // VirtualBox host-only

            let prioridad = 4;
            if (WIFI.test(nombre)) prioridad = 1;
            else if (dir.address === "192.168.137.1") prioridad = 2; // punto de acceso móvil de Windows
            else if (/ethernet|local/i.test(nombre)) prioridad = 3;

            lista.push({ ip: dir.address, nombre, prioridad });
        }
    }

    return lista.sort((a, b) => a.prioridad - b.prioridad);
}

/*----------------------------------
    Certificado autofirmado (se reutiliza entre reinicios)
----------------------------------*/
function certificadoVigente(rutaCert) {
    try {
        const x509 = new crypto.X509Certificate(fs.readFileSync(rutaCert));
        const vence = new Date(x509.validTo).getTime();
        return vence - Date.now() > 30 * 24 * 60 * 60 * 1000;     // más de 30 días de margen
    } catch (e) {
        return false;
    }
}

async function cargarOCrearCertificado() {
    const rutaKey = path.join(DIR_CERTS, "key.pem");
    const rutaCert = path.join(DIR_CERTS, "cert.pem");

    if (fs.existsSync(rutaKey) && fs.existsSync(rutaCert) && certificadoVigente(rutaCert)) {
        return { key: fs.readFileSync(rutaKey), cert: fs.readFileSync(rutaCert) };
    }

    let selfsigned;
    try {
        selfsigned = require("selfsigned");
    } catch (e) {
        throw new Error("Falta el paquete 'selfsigned'. En la carpeta node-crud corre:  npm install selfsigned");
    }

    const altNames = [
        { type: 2, value: "localhost" },
        { type: 7, ip: "127.0.0.1" },
        ...ipsDeLaPc().map(c => ({ type: 7, ip: c.ip }))
    ];

    const pems = await Promise.resolve(selfsigned.generate(
        [{ name: "commonName", value: "StockDesktop" }],
        {
            days: 365,
            keySize: 2048,
            algorithm: "sha256",
            extensions: [
                { name: "basicConstraints", cA: false },
                { name: "subjectAltName", altNames }
            ]
        }
    ));

    fs.mkdirSync(DIR_CERTS, { recursive: true });
    fs.writeFileSync(rutaKey, pems.private);
    fs.writeFileSync(rutaCert, pems.cert);

    return { key: pems.private, cert: pems.cert };
}

/*----------------------------------
    Solo la propia PC puede pedir la dirección y la clave del scanner
----------------------------------*/
function esLocal(req) {
    const origen = req.socket.remoteAddress || "";
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(origen)) return false;

    // CORS está abierto en server.js: aun desde la PC, solo aceptamos páginas propias
    const web = req.get("origin");
    if (!web) return true;
    return /^(https:\/\/stockupt\.app|https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/i.test(web);
}

/*----------------------------------
    Rutas HTTP (también disponibles en el servidor HTTPS)
----------------------------------*/
function montar(app) {
    const www = carpetaWww();

    app.get("/movil.html", (req, res) => {
        res.sendFile(path.join(www, "movil.html"));
    });

    app.use("/movil", express.static(path.join(www, "movil"), { index: false }));

    app.get("/conectar-celular", (req, res) => {
        if (!esLocal(req)) {
            return res.status(403).json({ error: "Solo se puede pedir desde la propia PC." });
        }

        const token = process.env.ESCANER_TOKEN || "";
        const sufijo = token ? "#t=" + encodeURIComponent(token) : "";
        const lista = ipsDeLaPc();

        res.json({
            httpsListo: estado.httpsListo,
            motivo: estado.httpsListo ? "" : estado.motivo,
            puertoHttps: PUERTO_HTTPS,
            conClave: !!token,
            ips: lista.map(c => ({
                ip: c.ip,
                nombre: c.nombre,
                url: `https://${c.ip}:${PUERTO_HTTPS}/movil.html${sufijo}`
            }))
        });
    });
}

/*----------------------------------
    Servidor HTTPS (mismo app de Express que el puerto 3000)
----------------------------------*/
async function iniciarHttps(app) {
    try {
        const credenciales = await cargarOCrearCertificado();
        const servidor = https.createServer(credenciales, app);

        servidor.on("error", (error) => {
            estado.httpsListo = false;
            estado.motivo = error.code === "EADDRINUSE"
                ? `El puerto ${PUERTO_HTTPS} ya está en uso por otro programa.`
                : error.message;
            console.error("⚠️ HTTPS del scanner móvil:", estado.motivo);
        });

        servidor.listen(PUERTO_HTTPS, "0.0.0.0", () => {
            estado.httpsListo = true;
            estado.motivo = "";
            console.log(`📱 Scanner móvil (HTTPS) en el puerto ${PUERTO_HTTPS}`);
            ipsDeLaPc().forEach(c =>
                console.log(`   https://${c.ip}:${PUERTO_HTTPS}/movil.html  (${c.nombre})`)
            );
        });
    } catch (error) {
        estado.httpsListo = false;
        estado.motivo = error.message;
        console.error("⚠️ Scanner móvil sin HTTPS:", error.message);
    }
}

module.exports = { montar, iniciarHttps, ipsDeLaPc, PUERTO_HTTPS };
