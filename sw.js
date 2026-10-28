/* mapability · funcionamiento sin conexión
   Guarda la web y las fichas para que la guía y el glosario se puedan consultar sin internet.
   Al cambiar archivos de la web, sube el número de VERSION. */
var VERSION = "mapability-v2";
var BASE = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "assets/css/estilos.css",
  "assets/js/app.js",
  "assets/vendor/leaflet/leaflet.js",
  "assets/vendor/leaflet/leaflet.css",
  "assets/icons/icon.svg",
  "assets/icons/icon-192.png",
  "datos/comunidades.json",
  "datos/tramites.json",
  "datos/itinerarios.json",
  "datos/centros.json",
  "datos/glosario.json",
  "datos/webinars.json",
  "datos/noticias.json",
  "content/mapas/madrid.geojson"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(BASE); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (claves) {
    return Promise.all(claves.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

/* Primero la red (para ver siempre las fichas más recientes) y, si no hay conexión, la copia guardada. */
self.addEventListener("fetch", function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request).then(function (r) {
      var copia = r.clone();
      caches.open(VERSION).then(function (c) { c.put(e.request, copia); });
      return r;
    }).catch(function () {
      return caches.match(e.request, { ignoreSearch: true }).then(function (r) { return r || caches.match("index.html"); });
    })
  );
});
