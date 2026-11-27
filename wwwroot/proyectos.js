(function () {
    "use strict";
    const API_BASE = window.STOCK_API || "";
    const ENDPOINT = API_BASE + "/proyectos";

    const form = document.getElementById("formProyecto");
    const inputNumero = document.getElementById("numeroProyecto");
    const inputMatricula = document.getElementById("matriculaLider");
    const inputNombre = document.getElementById("nombreProyecto");
    const inputBuscar = document.getElementById("buscarNumero");
    const btnBuscar = document.getElementById("btnBuscar");
    const resultadoBox = document.getElementById("resultadoBusqueda");
    const toastEl = document.getElementById("toast");
    let toastTimer = null;

    function mostrarToast(msg, esError) {
        if (!toastEl) return;
        toastEl.textContent = msg;
        toastEl.classList.toggle("error", Boolean(esError));
        toastEl.classList.add("show");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3200);
    }

    function esc(s) {
        return String(s ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    async function leerResp(resp) {
        const txt = await resp.text();
        try { return txt ? JSON.parse(txt) : {}; }
        catch { return { error: txt || "Error HTTP " + resp.status }; }
    }

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const numero_proyecto = inputNumero.value.trim();
        const matricula_lider = inputMatricula.value.trim();
        const nombre = inputNombre.value.trim();

        if (!numero_proyecto || !matricula_lider) {
            return mostrarToast("Completa número de proyecto y matrícula del líder", true);
        }

        try {
            const resp = await fetch(ENDPOINT, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    numero_proyecto,
                    matricula_lider,
                    nombre: nombre || null
                })
            });
            const data = await leerResp(resp);
            if (!resp.ok) throw new Error(data.error || data.message || "Error al registrar proyecto");

            mostrarToast((data.mensaje || "Proyecto registrado") + (data.lider ? " — Líder: " + data.lider : ""));
            form.reset();
            inputBuscar.value = numero_proyecto;
            await buscarProyecto(numero_proyecto);
        } catch (err) {
            mostrarToast(err.message || "No se pudo registrar el proyecto", true);
        }
    });

    async function buscarProyecto(numeroParam) {
        const num = String(numeroParam ?? inputBuscar.value ?? "").trim();
        if (!num) return mostrarToast("Ingresa un número de proyecto para buscar", true);

        try {
            const resp = await fetch(ENDPOINT + "/numero/" + encodeURIComponent(num));
            const data = await leerResp(resp);

            if (!resp.ok) {
                resultadoBox.style.display = "block";
                resultadoBox.innerHTML = `<p style="color:#dc2626;margin:0;"><strong>${esc(data.mensaje || data.error || "Proyecto no encontrado")}</strong></p>`;
                return;
            }

            const p = data.proyecto || {};
            resultadoBox.style.display = "block";
            resultadoBox.innerHTML =
                `<p><strong>Número:</strong> ${esc(p.numero_proyecto || p.numero)}</p>` +
                `<p><strong>Nombre:</strong> ${esc(p.nombre || "Sin nombre")}</p>` +
                `<p><strong>Líder:</strong> ${esc(p.nombre_lider || p.lider || "—")}${p.matricula_lider ? " (" + esc(p.matricula_lider) + ")" : ""}</p>` +
                `<p><strong>Área del líder:</strong> ${esc(p.area_lider || "—")}</p>`;
        } catch (err) {
            mostrarToast(err.message || "Error al buscar proyecto", true);
        }
    }

    btnBuscar.addEventListener("click", () => buscarProyecto());
    inputBuscar.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            buscarProyecto();
        }
    });
})();
