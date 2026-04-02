/// <reference lib="WebWorker" />

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE_NAME = 'todo-pwa-v1';
const APP_SHELL = ['/', '/index.html', '/offline.html', '/styles.css'];

sw.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
});

sw.addEventListener('fetch', (event: FetchEvent) => {
  const req = event.request;

  if (req.url.includes('/api/')) return;

  if (req.method !== 'GET') return;

  event.respondWith(
    (async () => {
      try {
        const networkResponse = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, networkResponse.clone());
        return networkResponse;
      } catch {
        const cached = await caches.match(req);
        if (cached) return cached;
        return caches.match('/offline.html') as Promise<Response>;
      }
    })()
  );
});