/**
 * service-worker.js
 * -----------------------------------------------------------------------
 * Cachea los ficheros propios de la app (HTML, CSS, JS, iconos) para que
 * funcione sin conexión y cargue al instante en visitas repetidas.
 *
 * Estrategia: "network falling back to cache" para lo propio de la app
 * (así, si hay conexión, siempre se sirve la versión más reciente y de
 * paso se refresca la caché; si no hay conexión, se sirve lo cacheado).
 *
 * Cuando cambies algo en la app, sube el número de CACHE_NAME (v1 -> v2)
 * para forzar a los navegadores a descartar la caché antigua.
 * -----------------------------------------------------------------------
 */

const CACHE_NAME = 'cuentas-casa-v1';

const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/base.css',
  './css/header.css',
  './css/nav.css',
  './css/movimientos.css',
  './css/categorias.css',
  './css/grafica.css',
  './css/loading.css',
  './js/data.js',
  './js/ui-helpers.js',
  './js/movimientos.js',
  './js/categorias.js',
  './js/grafica.js',
  './js/app.js',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-512-maskable.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // solo interceptamos peticiones GET; el resto (si las hubiera) van directas a la red
  if (req.method !== 'GET') return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        // guardamos en caché la respuesta buena, tanto de nuestros ficheros
        // como de recursos externos con CORS habilitado (p.ej. Chart.js)
        if (res && res.ok) {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
