/* Service worker do Hub
   - Arquivos do próprio app: respondem do cache e atualizam em segundo plano.
   - Streams de TV/rádio, APIs e fontes (outros domínios): vão direto para a rede.
   Ao publicar mudanças grandes, aumente o número em CACHE para forçar a limpeza. */

const CACHE = 'hub-v2';
const SHELL = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.json',
  'icon-192.png',
  'icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const network = fetch(req)
    .then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(cache => cache.put(req, copy));
      }
      return res;
    })
    .catch(() => null);

  event.waitUntil(network);

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(cached =>
      cached || network.then(res =>
        res || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())
      )
    )
  );
});
