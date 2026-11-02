// 画面の部品は「ネット優先・だめなら保存分」、地図データは「保存分優先」で圏外でも表示する
const VER = 'v1';
const SHELL = ['./', './index.html', './leaflet.js', './pwa.js', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png',
  './data/meta.json', './data/muni.json', './data/labels.json', './data/overview.png', './gsi/index.json'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open('shell-' + VER).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => !k.endsWith('-' + VER)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
let puts = 0;
const PHOTO_MAX = 12000;
async function trim(c) {
  const ks = await c.keys();
  for (let i = 0; i < ks.length - PHOTO_MAX; i++) await c.delete(ks[i]);
}
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  // 地理院の航空写真・淡色地図も保存分優先（古いものから消して上限を保つ）
  if (url.hostname === 'cyberjapandata.gsi.go.jp' && /^\/xyz\/(seamlessphoto|pale)\//.test(url.pathname)) {
    e.respondWith(caches.open('photo-' + VER).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.type !== 'opaque') { await c.put(req, res.clone()); if (++puts % 200 === 0) trim(c); }
      return res;
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  const isData = /\/(data\/c\d\d_\d\d\.png|gsi\/[\d_]+\.webp)$/.test(url.pathname);
  if (isData) {
    e.respondWith(caches.open('data-' + VER).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
  } else {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) caches.open('shell-' + VER).then(c => c.put(req, res.clone()));
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))));
  }
});
