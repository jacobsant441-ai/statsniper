// Builds the website into dist/web: a static folder any host can serve
// (GitHub Pages, Netlify, Vercel, Cloudflare Pages).
// Usage: npm run build:web   then   npm run preview   to try it at http://localhost:4173
//
// What makes it fast:
// - The page is written straight into index.html (no fetch-and-inject step).
// - Data files under LAZY_KB load before the first draw; bigger ones (player logs,
//   photos) load the first time a screen asks for them.
// - Every data, logo and script URL carries a short content hash (?v=...), so the
//   browser and the service worker can keep them until they change.
// - Logo files load with `defer`, in parallel, without blocking the first paint.
// - A service worker caches the app so repeat visits open instantly and work offline;
//   a web app manifest and icons make it installable on phones and desktops.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'dist', 'web');
const LAZY_KB = 300;
// Public live-scores file (Google Cloud function writes it every minute). Override with LIVE_URL for tests.
const LIVE_URL = process.env.LIVE_URL || 'https://storage.googleapis.com/statsniper-live-ab030f51/live.json';

const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');
const hash = (buf) => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 10);
const copy = (from, to = from) => { const dst = path.join(OUT, to); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(path.join(PUB, from), dst); return hash(fs.readFileSync(dst)); };
const safeJson = (s) => s.replace(/<\//g, '<\\/');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'data'), { recursive: true });

// Data files: hash every one, mark the big ones lazy.
const manifest = JSON.parse(read('data/manifest.json'));
// Private datasets stay on the owner's Mac: never copied into the public site or its manifest.
// Bookmaker prices are public since the paid Odds API plan (13 Nov 2026); only the owner's own bets stay private.
const PRIVATE = ['bets'];
PRIVATE.forEach((id) => delete manifest[id]);
// News (fetch-news.js) isn't listed in manifest.json (the Mac's local server lists it): include it when the file is there.
// Cleaned public copies of the owner's picks (export-public.js: no stakes, no prices): include them when present.
[['pubbets', 'Jacob\'s picks (public)'], ['pubprops', 'Player props we picked (public)'], ['pubalts', 'Alt lines we picked (public)']].forEach(([id, t]) => { if (!manifest[id] && fs.existsSync(path.join(PUB, 'data', id + '.json'))) manifest[id] = { title: t, description: 'Cleaned public copy from export-public.js.', updated: { at: new Date().toISOString(), by: 'build' } }; });
if (!manifest.valuelog && fs.existsSync(path.join(PUB, 'data', 'valuelog.json'))) manifest.valuelog = { title: 'Track record', description: 'Every bet we rated, settled from results (value-log.js).', updated: { at: new Date().toISOString(), by: 'build' } };
if (!manifest.news && fs.existsSync(path.join(PUB, 'data', 'news.json'))) manifest.news = { title: 'News', description: 'Latest ESPN headlines for every sport (fetch-news.js).', updated: { at: new Date().toISOString(), by: 'build' } };
const web = {};
let eagerKB = 0, lazyKB = 0;
for (const id of Object.keys(manifest)) {
  const file = `data/${id}.json`;
  if (!fs.existsSync(path.join(PUB, file))) { console.warn('missing', file); continue; }
  const v = copy(file);
  const kb = fs.statSync(path.join(PUB, file)).size / 1024;
  const lazy = kb > LAZY_KB;
  if (lazy) lazyKB += kb; else eagerKB += kb;
  web[id] = { v, ...(lazy ? { lazy: true } : {}) };
}
fs.writeFileSync(path.join(OUT, 'data', 'manifest.json'), JSON.stringify(manifest));

// Scripts and icons.
const runtimeV = copy('dash-runtime.js');
const logoFiles = fs.readdirSync(PUB).filter((f) => /^logos.*\.js$/.test(f));
const logoV = Object.fromEntries(logoFiles.map((f) => [f, copy(f)]));
fs.readdirSync(path.join(PUB, 'icons')).forEach((f) => copy(`icons/${f}`));
// The page's own script files (loaded after the main page script, in this order).
const PAGE_JS = ['player.js', 'games.js', 'standings.js'];
// Each runs in its own scope (as in the local runtime), so their top-level names never clash with the page's.
const wrapJs = (f) => { const dst = path.join(OUT, f); fs.writeFileSync(dst, '(function(){\n' + read(f) + '\n})();\n'); return hash(fs.readFileSync(dst)); };
const pageJsV = Object.fromEntries(PAGE_JS.map((f) => [f, wrapJs(f)]));

// The page: logo scripts become deferred, versioned loads.
const cssV = copy('app.css');
let page = read('page.html').replace('<link rel="stylesheet" href="app.css">', '');
page = page.replace(/<script src="(logos[^"]*\.js)"><\/script>/g, (m, f) => {
  if (!logoV[f]) throw new Error('page.html references a missing logo file: ' + f);
  return `<script defer src="${f}?v=${logoV[f]}"></script>`;
});
page = page.replace(/<script src="((?:player|games)\.js)"><\/script>/g, (m, f) => {
  if (!pageJsV[f]) throw new Error('page.html references a missing script: ' + f);
  return `<script src="${f}?v=${pageJsV[f]}"></script>`;
});
if (/<script src="(?!logos|player\.js|games\.js|standings\.js)/.test(page)) throw new Error('page.html references a script the web build does not ship');

const shell = read('index.html');
const fontLink = (shell.match(/<link href="https:\/\/fonts[^>]*>/) || [''])[0];
const style = shell.match(/<style>[\s\S]*?<\/style>/)[0];
const build = hash(JSON.stringify(web) + runtimeV + JSON.stringify(logoV) + JSON.stringify(pageJsV) + page);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>StatSniper</title>
<meta name="description" content="Sharp picks, broken down: NBA, football, NFL and UFC picks with team and player stats, props and a daily review.">
<meta name="theme-color" content="#0a0d12">
<meta name="color-scheme" content="dark">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="StatSniper">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/png" sizes="48x48" href="icons/favicon-48.png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${fontLink}
${style}
<link rel="stylesheet" href="app.css?v=${cssV}">
<style>html,body{background:#0a0d12;color-scheme:dark}#dash-root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}</style>
<script type="application/json" id="ss-web">${safeJson(JSON.stringify(web))}</script>
<script type="application/json" id="ss-live">${safeJson(JSON.stringify({ url: LIVE_URL }))}</script>
<script src="dash-runtime.js?v=${runtimeV}"></script>
</head>
<body>
<div id="dash-root">${page}</div>
<script>if ('serviceWorker' in navigator && location.protocol !== 'file:') addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));</script>
</body>
</html>
`;
fs.writeFileSync(path.join(OUT, 'index.html'), html);

// Web app manifest: makes it installable.
fs.writeFileSync(path.join(OUT, 'manifest.webmanifest'), JSON.stringify({
  name: 'StatSniper', short_name: 'StatSniper', description: 'Sharp picks, broken down.',
  start_url: './', scope: './', display: 'standalone', orientation: 'portrait',
  background_color: '#0a0d12', theme_color: '#0a0d12',
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}, null, 2));

// Service worker: the page shell is network-first (so a new build shows up), versioned
// files are cache-first (their URL changes when they do), everything works offline.
const precache = ['./', `dash-runtime.js?v=${runtimeV}`, `app.css?v=${cssV}`, ...logoFiles.map((f) => `${f}?v=${logoV[f]}`), ...PAGE_JS.map((f) => `${f}?v=${pageJsV[f]}`),
  ...Object.entries(web).filter(([, x]) => !x.lazy).map(([id, x]) => `data/${id}.json?v=${x.v}`), 'manifest.webmanifest', 'icons/icon-192.png'];
fs.writeFileSync(path.join(OUT, 'sw.js'), `// StatSniper service worker, build ${build}. Generated by scripts/build-web.js.
const CACHE = 'statsniper-${build}';
const PRECACHE = ${JSON.stringify(precache)};
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('statsniper-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // fonts and the like: browser default
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('./', copy)); return res; }).catch(() => caches.match('./')));
    return;
  }
  if (url.searchParams.has('v') || url.pathname.includes('/icons/')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })));
  }
});
`);

fs.writeFileSync(path.join(OUT, 'web.json'), JSON.stringify(web)); // the newest data versions; the page re-reads it to pick up fresh results
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');      // GitHub Pages: serve files as they are
fs.writeFileSync(path.join(OUT, '_headers'), `/*\n  X-Content-Type-Options: nosniff\n/index.html\n  Cache-Control: no-cache\n/sw.js\n  Cache-Control: no-cache\n/data/*\n  Cache-Control: public, max-age=31536000, immutable\n/*.js\n  Cache-Control: public, max-age=31536000, immutable\n`); // Netlify / Cloudflare Pages

const size = (p) => fs.statSync(p).size;
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const total = walk(OUT).reduce((s, f) => s + size(f), 0);
const first = size(path.join(OUT, 'index.html')) + size(path.join(PUB, 'dash-runtime.js')) + logoFiles.reduce((s, f) => s + size(path.join(PUB, f)), 0) + eagerKB * 1024;
console.log(`Built dist/web (build ${build}): ${(total / 1048576).toFixed(1)} MB in total; first visit loads ${(first / 1048576).toFixed(1)} MB before compression, ${(lazyKB / 1024).toFixed(1)} MB loads only when needed.`);
