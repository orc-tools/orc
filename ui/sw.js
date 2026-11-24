const CACHE = 'orc-offline-v5';
const PUBLIC_ASSETS = ['/offline.html', '/pwa/icon-180.png', '/ticket-outbox.js', '/offline-ticket-page.js', '/vendor/orc-ds.tokens.css', '/vendor/orc-ds.min.js'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PUBLIC_ASSETS)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('orc-offline-') && key !== CACHE).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // A page from a run folder or checkout loads straight from the network: a
  // fetch from here would drop its Sec-Fetch-Dest, and Orc opens such a page
  // on its own files origin only for a page load it can see.
  if (event.request.mode === 'navigate' && url.pathname.startsWith('/runs/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(async () => {
      const cached = await caches.match('/offline.html');
      return cached || new Response('Orc is offline. Reconnect and reload.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    }));
  } else if (PUBLIC_ASSETS.includes(url.pathname)) {
    event.respondWith(fetch(event.request).catch(() => caches.match(url.pathname)));
  }
});
