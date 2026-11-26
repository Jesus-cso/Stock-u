/* =====================================================
   sesion.js  -  Sesión compartida de StockUPT

   Uso: incluirlo al INICIO del <body> de cada página
   protegida (todas menos Login.html y Crearcuenta.html):

       <script src="sesion.js"></script>

   Si la página usa el scanner remoto, sesion.js va ANTES:

       <script src="sesion.js"></script>
       <script src="escaner-remoto.js"></script>
   ===================================================== */
(function () {
    "use strict";

    var API = window.STOCK_API || "";
    window.STOCK_API = API;

    var CLAVE_TOKEN = "stockToken";
    var CLAVE_USUARIO = "usuarioActivo";
    var LOGIN = "Login.html";

    // Rutas que NO deben cerrar la sesión si responden 401/403.
    // El scanner remoto las consulta cada segundo y maneja el error por su cuenta
    // (muestra "Scanner: inicia sesión" en lugar de sacar al usuario).
    var RUTAS_SIN_LOGOUT = ["/escaneos", "/conectar-celular"];

    function leer(clave) {
        try {
            return localStorage.getItem(clave) || sessionStorage.getItem(clave) || null;
        } catch (e) { return null; }
    }

    function limpiar() {
        try {
            [localStorage, sessionStorage].forEach(function (s) {
                s.removeItem(CLAVE_TOKEN);
                s.removeItem(CLAVE_USUARIO);
            });
        } catch (e) { }
    }

    function irALogin() {
        limpiar();
        if (!/Login\.html$/i.test(location.pathname)) location.replace(LOGIN);
    }

    function usuario() {
        try { return JSON.parse(leer(CLAVE_USUARIO) || "null"); }
        catch (e) { return null; }
    }

    function esRutaSinLogout(url) {
        var ruta = url.slice(API.length).split("?")[0].split("#")[0];
        return RUTAS_SIN_LOGOUT.some(function (r) {
            return ruta === r || ruta.indexOf(r + "/") === 0;
        });
    }

    window.Sesion = {
        token: function () { return leer(CLAVE_TOKEN); },
        usuario: usuario,
        logout: irALogin
    };

    // ---- 1. Guardia: sin token no se entra ----
    if (!window.Sesion.token()) {
        irALogin();
        return;
    }

    // ---- 2 y 3. fetch con token + manejo de 401 ----
    var fetchOriginal = window.fetch.bind(window);

    window.fetch = function (entrada, opciones) {
        var url = typeof entrada === "string" ? entrada : (entrada && entrada.url) || "";
        var esApi = url.indexOf(API) === 0;
        var esLogin = url.indexOf(API + "/auth/") === 0;

        if (esApi && !esLogin) {
            opciones = opciones || {};
            var headers = new Headers(opciones.headers ||
                (typeof entrada !== "string" && entrada.headers) || {});
            if (!headers.has("Authorization")) {
                headers.set("Authorization", "Bearer " + window.Sesion.token());
            }
            opciones.headers = headers;
        }

        return fetchOriginal(entrada, opciones).then(function (resp) {
            if (esApi && !esLogin && resp.status === 401 && !esRutaSinLogout(url)) {
                irALogin();
            }
            return resp;
        });
    };
})();