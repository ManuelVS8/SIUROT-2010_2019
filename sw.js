// sw.js — Service worker de la web de recuerdos (CEIP Manuel Siurot)
// Solo cachea el "esqueleto" de la app (HTML, manifest, iconos), NO las fotos/vídeos,
// para no llenar el almacenamiento del móvil con varios GB automáticamente.

const CACHE_NAME = 'siurot-shell-v1';
const APP_SHELL = [
  './index.html',
  './site.webmanifest',
  './icono192.png',
  './icono512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((nombres) =>
      Promise.all(
        nombres
          .filter((n) => n !== CACHE_NAME)
          .map((n) => caches.delete(n))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Las fotos/vídeos (fotos/full, fotos/thumb, manifest.json) siempre van directas
  // a la red: no las cacheamos para no saturar el móvil.
  if (url.pathname.includes('/fotos/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // El resto del "esqueleto" de la app: red primero, y si falla (sin conexión),
  // se sirve la copia guardada en caché.
  event.respondWith(
    fetch(event.request)
      .then((respuesta) => {
        const copia = respuesta.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copia));
        return respuesta;
      })
      .catch(() => caches.match(event.request))
  );
});
