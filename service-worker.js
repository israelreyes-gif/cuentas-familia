const CACHE_NAME = 'cuentas-casa-v4';

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
  './css/auth.css',
  './js/data.js',
  './js/ui-helpers.js',
  './js/auth.js',
  './js/push.js',
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
  if (req.method !== 'GET') return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});

/** Muestra la notificación cuando llega un push del Worker (p.ej. el aviso de nómina el día 1). */
self.addEventListener('push', (event) => {
  let data = { title: 'Cuentas de casa', body: 'Tienes un aviso nuevo.' };
  try { data = event.data.json(); } catch (_) { /* payload no era JSON válido, se usa el texto por defecto */ }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: './assets/icon-192.png',
      badge: './assets/icon-192.png',
      data: { url: './' },
    })
  );
});

/** Al tocar la notificación, abre la app (o la enfoca si ya está abierta). */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('./');
    })
  );
});
