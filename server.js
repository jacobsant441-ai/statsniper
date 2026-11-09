// Zero-dependency static server for StatSniper.
//   npm start     serves public/ (the editable app) at http://localhost:3000
//   npm run preview   serves dist/web (the built website) at http://localhost:4173, gzipped like a real host
const http = require('http');
const fs = require('fs');
const path = require('path');

const zlib = require('zlib');
const ROOT = path.resolve(__dirname, process.env.ROOT || 'public');
const PORT = Number(process.env.PORT) || 3000;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.normalize(path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
    const type = TYPES[path.extname(file)] || 'application/octet-stream';
    const gzip = /gzip/.test(req.headers['accept-encoding'] || '') && /text|json|javascript|manifest|svg/.test(type);
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', ...(gzip ? { 'Content-Encoding': 'gzip' } : {}) });
    res.end(gzip ? zlib.gzipSync(buf) : buf);
  });
}).listen(PORT, () => console.log(`StatSniper running at http://localhost:${PORT}`));
