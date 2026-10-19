// Super Pixel Bros 3D service worker: precache the app shell for offline
// play. Strategy: navigation = network-first; static assets = cache-first
// (bump VERSION whenever any precached file changes). Vendored libraries
// (three, rapier) are part of the shell — they only change on re-vendor.
// Not registered on localhost (see main.js).

const VERSION = 'spb3d-v0.6.0';
const CACHE = VERSION + '-shell';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/main.js',
  './js/game.js',
  './js/hero.js',
  './js/levels.js',
  './js/rivals.js',
  './js/phys.js',
  './js/input.js',
  './js/view.js',
  './js/i18n.js',
  './js/audio.js',
  './js/renderer.js',
  './js/models.js',
  './js/ui.js',
  './vendor/three.module.js',
  './vendor/three.core.js',
  './vendor/rapier.mjs',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(ASSETS.map((a) => c.add(a))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('spb3d-v') && k !== CACHE).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
