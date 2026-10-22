// GitHub Pages のサブディレクトリでも動作する相対パス指定。
const CACHE_NAME = 'little-bugs-v0.2.0';
const CORE = ['./', './index.html', './style.css', './app.js', './audio-engine.js', './visual.js', './manifest.webmanifest', './assets/icon-192.png', './assets/icon-512.png', './assets/apple-touch-icon.png'];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
  // p5.js の CDN スクリプトも初回ロード後はキャッシュする。
  if (url.origin !== self.location.origin && url.hostname !== 'cdn.jsdelivr.net') return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((res) => {
    if (res.ok || res.type === 'opaque') {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
    }
    return res;
  })));
});
