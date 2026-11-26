/* ============================================================
   Scanner remoto: recibe los códigos que envía el celular
   (app de Expo o la página movil.html) y ofrece el botón
   "Conectar celular", que muestra un QR para abrir esa página.

   Uso en una página:
     1) Define   window.alEscanearRemoto = function (codigo) { ... }
     2) Incluye  <script src="sesion.js"></script>
                 <script src="escaner-remoto.js"></script>
        (sesion.js debe cargarse ANTES)

   Requiere haber iniciado sesión: /escaneos y /conectar-celular
   se consultan con el token JWT en el header Authorization.
   ============================================================ */
(function () {
    "use strict";

    // Misma dirección de API que usa el resto de la aplicación (sesion.js la
    // deja en window.STOCK_API). Si no existe, se usa el origen de la página.
    const BASE = window.STOCK_API || location.origin;
    const INTERVALO_MS = 700;
    const INTERVALO_SIN_SESION_MS = 3000;

    // Claves donde el login pudo guardar el token (respaldo si no existe Sesion).
    const CLAVES_TOKEN = ["token", "jwt", "accessToken", "authToken", "access_token", "id_token"];

    let ultimoId = null;
    let conectado = null; // true | false | "sesion"

    // ── Token ──────────────────────────────────
    function leerAlmacen(almacen) {
        try {
            for (const clave of CLAVES_TOKEN) {
                const valor = almacen.getItem(clave);
                if (valor) return valor.replace(/^"|"$/g, "").replace(/^Bearer\s+/i, "").trim();
            }
            // Respaldo: cualquier valor guardado que contenga un JWT
            for (let i = 0; i < almacen.length; i++) {
                const valor = almacen.getItem(almacen.key(i)) || "";
                const m = valor.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/);
                if (m) return m[0];
            }
        } catch (e) { /* almacenamiento bloqueado */ }
        return null;
    }

    function obtenerToken() {
        // 1) sesion.js (es lo que usa el resto de la aplicación)
        try {
            if (window.Sesion && typeof window.Sesion.token === "function") {
                const t = window.Sesion.token();
                if (t) return String(t).replace(/^Bearer\s+/i, "").trim();
            }
        } catch (e) { /* sesion.js no cargó */ }

        // 2) Respaldo: buscar directo en el almacenamiento
        return leerAlmacen(localStorage) || leerAlmacen(sessionStorage);
    }

    function cabecerasAuth() {
        const token = obtenerToken();
        return token ? { "Authorization": "Bearer " + token } : {};
    }

    // ── Indicador flotante (también es el botón "Conectar celular") ──
    const badge = document.createElement("button");
    badge.type = "button";
    badge.title = "Conectar un celular como scanner";
    badge.style.cssText =
        "position:fixed;right:14px;bottom:14px;z-index:99999;background:#0F172A;color:#fff;" +
        "font:12px Arial,sans-serif;padding:6px 12px;border-radius:999px;opacity:.92;border:0;cursor:pointer;" +
        "display:flex;gap:7px;align-items:center;box-shadow:0 2px 8px rgba(0,0,0,.3);transition:opacity .3s";
    const punto = document.createElement("span");
    punto.style.cssText = "width:8px;height:8px;border-radius:50%;background:#94A3B8;display:inline-block";
    const texto = document.createElement("span");
    texto.textContent = "Scanner remoto…";
    badge.appendChild(punto);
    badge.appendChild(texto);
    document.body.appendChild(badge);

    let temporizadorTexto = null;

    function textoEnReposo() {
        if (conectado === true) return "📱 Conectar celular";
        if (conectado === "sesion") return "Scanner: inicia sesión";
        return "Scanner remoto sin conexión";
    }

    function estadoConexion(estado) {
        if (estado === conectado) return;
        conectado = estado;
        punto.style.background =
            estado === true ? "#22C55E" :
                estado === "sesion" ? "#F59E0B" : "#EF4444";
        texto.textContent = textoEnReposo();
    }

    function avisoEscaneo(codigo) {
        texto.textContent = "📱 " + codigo;
        clearTimeout(temporizadorTexto);
        temporizadorTexto = setTimeout(function () {
            texto.textContent = textoEnReposo();
        }, 2500);
    }

    function procesar(codigo) {
        avisoEscaneo(codigo);
        if (typeof window.alEscanearRemoto !== "function") return;
        try {
            window.alEscanearRemoto(codigo);
        } catch (e) {
            console.error("Error procesando escaneo remoto:", e);
        }
    }

    // ── Consulta periódica ─────────────────────
    async function consultar() {
        let espera = INTERVALO_MS;

        try {
            // Sin token ni se consulta: evita inundar el servidor de 401
            if (!obtenerToken()) {
                estadoConexion("sesion");
                espera = INTERVALO_SIN_SESION_MS;
            } else {
                const res = await fetch(BASE + "/escaneos?desde=" + (ultimoId ?? 0), {
                    headers: cabecerasAuth()
                });

                if (res.status === 401 || res.status === 403) {
                    // Token vencido, inválido o sin permiso
                    estadoConexion("sesion");
                    espera = INTERVALO_SIN_SESION_MS;
                } else if (!res.ok) {
                    throw new Error("Error " + res.status);
                } else {
                    const data = await res.json();
                    estadoConexion(true);

                    if (ultimoId === null) {
                        // Primera vez: ignorar lo que ya estaba pendiente antes de abrir la pantalla
                        ultimoId = data.ultimo;
                    } else if (data.ultimo < ultimoId) {
                        // El servidor se reinició y sus ids empezaron de nuevo
                        ultimoId = 0;
                    } else {
                        for (const e of data.escaneos) {
                            ultimoId = Math.max(ultimoId, e.id);
                            procesar(e.codigo);
                        }
                    }
                }
            }
        } catch (e) {
            estadoConexion(false);
        }

        setTimeout(consultar, espera);
    }

    consultar();

    // ============================================================
    //  Ventana "Conectar celular" (QR con la dirección actual de la PC)
    // ============================================================
    let ventana = null;

    function el(etiqueta, estilo, contenido) {
        const nodo = document.createElement(etiqueta);
        if (estilo) nodo.style.cssText = estilo;
        if (contenido !== undefined) nodo.textContent = contenido;
        return nodo;
    }

    function cargarLibreriaQr() {
        return new Promise(function (resolver, rechazar) {
            if (typeof window.qrcode === "function") return resolver();
            const s = document.createElement("script");
            s.src = BASE + "/movil/qrcode.js";
            s.onload = function () { resolver(); };
            s.onerror = function () { rechazar(new Error("No se pudo cargar el generador de QR del servidor.")); };
            document.head.appendChild(s);
        });
    }

    function dibujarQr(contenedor, url) {
        const qr = window.qrcode(0, "M");
        qr.addData(url);
        qr.make();
        // El SVG lo genera la librería local a partir de la URL; no lleva texto de terceros.
        contenedor.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
        const svg = contenedor.querySelector("svg");
        if (svg) { svg.style.width = "100%"; svg.style.height = "100%"; svg.style.display = "block"; }
    }

    function cerrarVentana() {
        if (ventana) { ventana.remove(); ventana = null; }
        document.removeEventListener("keydown", alTeclear);
    }

    function alTeclear(ev) { if (ev.key === "Escape") cerrarVentana(); }

    async function abrirVentana() {
        if (ventana) return;

        ventana = el("div",
            "position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,.6);display:flex;" +
            "align-items:center;justify-content:center;padding:16px;font-family:Arial,sans-serif");
        ventana.addEventListener("click", function (ev) { if (ev.target === ventana) cerrarVentana(); });
        document.addEventListener("keydown", alTeclear);

        const tarjeta = el("div",
            "background:#fff;color:#0F172A;border-radius:14px;width:100%;max-width:380px;" +
            "padding:20px;box-shadow:0 12px 40px rgba(0,0,0,.35);max-height:94vh;overflow-y:auto");
        ventana.appendChild(tarjeta);

        tarjeta.appendChild(el("h3", "font-size:18px;margin:0 0 6px", "Conectar celular"));
        tarjeta.appendChild(el("p", "font-size:13px;color:#475569;line-height:1.5;margin:0 0 12px",
            "Conecta el celular a la misma WiFi que esta PC y escanea este código con su cámara normal."));

        const zona = el("div", "display:flex;flex-direction:column;align-items:center;gap:10px");
        zona.appendChild(el("p", "font-size:13px;color:#475569", "Buscando la dirección de esta PC…"));
        tarjeta.appendChild(zona);

        const pie = el("button",
            "margin-top:14px;width:100%;padding:10px;border:0;border-radius:10px;background:#E2E8F0;" +
            "font-size:14px;font-weight:700;cursor:pointer;color:#0F172A", "Cerrar");
        pie.type = "button";
        pie.addEventListener("click", cerrarVentana);
        tarjeta.appendChild(pie);

        document.body.appendChild(ventana);

        // ── Pedir la dirección al servidor ──
        let datos;
        try {
            const res = await fetch(BASE + "/conectar-celular", { headers: cabecerasAuth() });
            if (res.status === 401 || res.status === 403) {
                throw new Error("inicia sesión en la aplicación e inténtalo de nuevo.");
            }
            datos = await res.json();
            if (!res.ok) throw new Error(datos.error || "Error " + res.status);
            await cargarLibreriaQr();
        } catch (e) {
            zona.replaceChildren(el("p", "font-size:13px;color:#B91C1C;line-height:1.5",
                "No se pudo obtener la dirección: " + e.message +
                " ¿Está corriendo el servidor y tiene el archivo movil.js?"));
            return;
        }

        zona.replaceChildren();

        if (!datos.ips.length) {
            zona.appendChild(el("p", "font-size:13px;color:#B91C1C;line-height:1.5",
                "No encontré una red activa en esta PC. Conéctala al WiFi (o activa el punto de acceso móvil) y vuelve a abrir esta ventana."));
            return;
        }

        if (!datos.httpsListo) {
            zona.appendChild(el("p",
                "font-size:13px;color:#92400E;background:#FEF3C7;border-radius:8px;padding:10px;line-height:1.5",
                "El enlace seguro (https) aún no está listo: " + datos.motivo +
                " Sin él, la cámara del celular no funciona."));
        }

        let seleccionada = datos.ips[0];

        const caja = el("div", "width:230px;height:230px;background:#fff;border:1px solid #E2E8F0;border-radius:10px;padding:6px");
        const direccion = el("div", "font:12px ui-monospace,Consolas,monospace;word-break:break-all;text-align:center;color:#1E3A8A");

        function mostrar(ip) {
            seleccionada = ip;
            dibujarQr(caja, ip.url);
            direccion.textContent = ip.url.replace(/#t=.*/, "");
        }

        if (datos.ips.length > 1) {
            const lista = el("select", "width:100%;padding:8px;border:1px solid #CBD5E1;border-radius:8px;font-size:13px");
            datos.ips.forEach(function (ip, i) {
                const o = document.createElement("option");
                o.value = String(i);
                o.textContent = ip.ip + "  ·  " + ip.nombre;
                lista.appendChild(o);
            });
            lista.addEventListener("change", function () { mostrar(datos.ips[Number(lista.value)]); });
            zona.appendChild(el("p", "font-size:12px;color:#64748B;align-self:flex-start",
                "Hay varias redes. Elige la misma a la que está conectado el celular:"));
            zona.appendChild(lista);
        }

        zona.appendChild(caja);
        zona.appendChild(direccion);
        mostrar(seleccionada);

        zona.appendChild(el("p", "font-size:12px;color:#64748B;line-height:1.5;text-align:center",
            "La primera vez el celular dirá «conexión no segura»: toca Avanzado → Continuar. " +
            "Es normal en una red local. Después permite la cámara."));

        if (datos.conClave) {
            zona.appendChild(el("p", "font-size:12px;color:#64748B;text-align:center",
                "🔒 Este código incluye la clave del scanner; no lo compartas."));
        }
    }

    badge.addEventListener("click", abrirVentana);
})();