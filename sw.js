/* Coral Reader — Service Worker
 * Estrategia: app-shell precacheado + runtime cache inteligente.
 * Todo el contenido de libros vive en IndexedDB/OPFS (no aquí),
 * así que el SW solo cachea la carcasa de la app y assets.
 * Actualizaciones silenciosas: skipWaiting + clients.claim.
 */
const VERSION = 'coral-v3.4.0';
const SHELL_CACHE = `shell-${VERSION}`;
const RUNTIME_CACHE = `runtime-${VERSION}`;
const COVER_CACHE = 'coral-covers';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/db.js',
  './js/storage.js',
  './js/models.js',
  './js/coral.js',
  './js/coralview.js',
  './js/library.js',
  './js/reader.js',
  './js/stats.js',
  './js/covers.js',
  './js/search.js',
  './js/settings.js',
  './js/notes.js',
  './js/fileexplorer.js',
  './js/importer.js',
  './js/toast.js',
  './js/parsers/index.js',
  './js/parsers/epub.js',
  './js/parsers/pdf.js',
  './js/parsers/txt.js',
  './js/parsers/markdown.js',
  './js/parsers/html.js',
  './js/parsers/fb2.js',
  './js/parsers/cbz.js',
  './js/parsers/docx.js',
  './js/parsers/mobi.js',
  './js/vendor/fflate.min.js',
  './js/vendor/pdf.min.js',
  './js/vendor/pdf.worker.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/favicon.svg',
  './fonts/inter.woff2',
  './fonts/literata.woff2',
  './fonts/literata-italic.woff2'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // addAll falla si un recurso falta; añadimos tolerante a fallos.
    await Promise.allSettled(SHELL.map((u) => cache.add(u)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => {
      if (![SHELL_CACHE, RUNTIME_CACHE, COVER_CACHE].includes(k)) return caches.delete(k);
    }));
    await self.clients.claim();
  })());
});

// Permite forzar activación desde la app tras detectar update
self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

function isCover(url) {
  return /covers\.openlibrary\.org|books\.google|googleusercontent|\/cover\//.test(url);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Portadas remotas: cache-first, larga duración
  if (isCover(url.href)) {
    e.respondWith((async () => {
      const cache = await caches.open(COVER_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req, { mode: 'cors' });
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch (_) {
        return hit || Response.error();
      }
    })());
    return;
  }

  // Solo gestionamos same-origin para la carcasa
  if (url.origin !== self.location.origin) return;

  // Navegación → app shell (SPA), network-first con fallback offline
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(RUNTIME_CACHE);
        cache.put('./index.html', res.clone());
        return res;
      } catch (_) {
        const cache = await caches.open(SHELL_CACHE);
        return (await cache.match('./index.html')) || (await cache.match('./'));
      }
    })());
    return;
  }

  // Assets → stale-while-revalidate
  e.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const hit = await cache.match(req);
    // stale-while-revalidate REAL: se guarda la copia fresca en la MISMA caché
    // que se lee, de modo que la próxima carga sirva ya el código actualizado.
    const fetchPromise = fetch(req).then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => hit);
    return hit || fetchPromise;
  })());
});
