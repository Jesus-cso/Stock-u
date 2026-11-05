// Service worker mínimo: solo lo necesario para que el navegador
// considere la página "instalable" como app (requisito técnico de las PWA).
// No cachea nada de la API, así que scanner.html siempre pide datos frescos.

const CACHE_NAME = "stockupt-scanner-v1";
const ARCHIVOS_BASICOS = [
    "./scanner.html",
    "./manifest.json",
    "./icons/icon-192.png",
    "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ARCHIVOS_BASICOS))
    );
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((nombres) =>
            Promise.all(
                nombres
                    .filter((nombre) => nombre !== CACHE_NAME)
                    .map((nombre) => caches.delete(nombre))
            )
        )
    );
    self.clients.claim();
});

self.addEventListener("fetch", (event) => {
    // Las llamadas a la API (productos, etc.) siempre van a la red, nunca a caché,
    // para que el inventario que ves esté siempre actualizado.
    if (event.request.url.includes(":3000/")) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then((respuestaCache) => {
            return respuestaCache || fetch(event.request);
        })
    );
});