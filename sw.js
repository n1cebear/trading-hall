/*
 * Offline support for n1cebear's toolbox.
 * - App files (same origin): network-first, so a new deploy shows up immediately; cache is the offline fallback.
 * - Minecraft textures, wiki icons and fonts: cache-first (they never change for a given version).
 * - The page posts { type: 'warm', urls } once, and every texture the app can show is cached in the background.
 */
const APP = 'toolbox-app-v75';
const ASSETS = 'toolbox-assets-v1';
const CORE = [
  './', 'index.html', 'manifest.webmanifest', 'icon.svg',
  'css/styles.css', 'css/hall.css', 'css/hall-canvas.css', 'css/enchanting.css', 'css/overview.css', 'css/builds.css', 'css/portal.css', 'css/trims.css', 'css/style-neu.css', 'js/vendor/three.lite.module.min.js', 'js/vendor/three.LICENSE', 'fonts/Monocraft.ttf',
  'js/core/icons.js', 'js/core/icon-list.js', 'js/core/i18n.js', 'js/core/util.js', 'js/core/store.js', 'js/core/app.js',
  'js/data/enchantments.js', 'js/data/villagers.js', 'js/data/trims.js', 'js/data/presets.js', 'js/data/items.js',
  'js/data/lang/index.js', 'js/data/lang/en_us.js',
  'js/modules/hall.js', 'js/modules/hall-canvas.js', 'js/modules/enchanting.js', 'js/modules/trims.js', 'js/modules/builds.js', 'js/modules/portal.js', 'js/modules/overview.js',
];
const ASSET_HOSTS = ['cdn.jsdelivr.net', 'minecraft.wiki', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== APP && k !== ASSETS).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

/** jsDelivr sends CORS headers: fetch in cors mode so cached textures also work as CSS masks (enchant glint). */
function fetchAsset(url) {
  const cors = new URL(url).hostname !== 'minecraft.wiki';
  return fetch(url, cors ? { mode: 'cors', credentials: 'omit' } : { mode: 'no-cors' });
}

async function fromAssetCache(req) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(req.url);
  if (hit && !(hit.type === 'opaque' && req.mode === 'cors')) return hit;
  const res = await fetchAsset(req.url);
  if (res.ok || res.type === 'opaque') cache.put(req.url, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(APP);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') return cache.match('index.html');
    throw err;
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) e.respondWith(networkFirst(req));
  else if (ASSET_HOSTS.includes(url.hostname)) e.respondWith(fromAssetCache(req));
});

// background warm-up of every texture, a few at a time
self.addEventListener('message', (e) => {
  if (!e.data || e.data.type !== 'warm') return;
  e.waitUntil((async () => {
    const cache = await caches.open(ASSETS);
    const todo = [];
    for (const url of e.data.urls) if (!(await cache.match(url))) todo.push(url);
    for (let i = 0; i < todo.length; i += 6) {
      await Promise.all(todo.slice(i, i + 6).map((url) =>
        fetchAsset(url).then((res) => (res.ok || res.type === 'opaque') && cache.put(url, res)).catch(() => {})));
    }
  })());
});
