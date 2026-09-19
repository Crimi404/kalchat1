const CACHE_NAME = 'kalchat-shell-v1';
const SHELL_FILES = ['/', '/css/style.css', '/js/app.js', '/img/logo.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// On ne met en cache que la coquille statique. Tout le reste (API, uploads,
// Socket.io) passe toujours directement par le réseau pour rester en temps réel.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isApiOrDynamic =
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/uploads/') ||
    url.pathname.startsWith('/socket.io/');

  if (event.request.method !== 'GET' || isApiOrDynamic) {
    return; // laisse passer normalement, pas d'interception
  }

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
