/* Dues offline cache: the app opens with no internet after the first visit. Data is encrypted in the browser's storage, not here; Supabase requests are never cached. */
const CACHE = 'dues-static-v2';
const SHELL = ['app.html', 'index.html', 'dues.css', 'theme.js', 'config.js', 'store.js', 'vault.js', 'cloud.js', 'gate.js', 'app.js', 'reset.html', 'reset.js', 'pay.html', 'pay.js', 'icon.svg', 'icon-192.png', 'manifest.webmanifest'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin && !/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) return;
  // network first so updates arrive at once; the cached copy is used offline
  e.respondWith(fetch(e.request).then((r) => { if (r.ok || r.type === 'opaque') { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
