// Bundles StatSniper into one self-contained HTML file: dist/statsniper.html
// Usage: npm run build
// The output needs no server: open it directly or publish it as a single page.
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', 'public');
const OUT = path.join(__dirname, '..', 'dist');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');
// Make JSON safe inside <script type="application/json">.
const safeJson = (s) => s.replace(/<\//g, '<\\/').replace(/<!--/g, '<\\!--');

const shell = read('index.html');
const fontLink = (shell.match(/<link href="https:\/\/fonts[^>]*>/) || [''])[0];
const style = shell.match(/<style>[\s\S]*?<\/style>/)[0];

// Logo scripts become inline scripts in the bundle; drop their src tags from the page.
const logoFiles = ['logos.js', 'logos_nba.js', 'logos_epl.js', 'logos_laliga.js', 'logos_nfl.js', 'logos_ucl.js'];
let page = read('page.html').replace('<link rel="stylesheet" href="app.css">', `<style>${read('app.css')}</style>`);
logoFiles.forEach((f) => { page = page.replace(`<script src="${f}"></script>`, ''); });
if (/<script src=/.test(page)) throw new Error('page.html still references an external script');

const manifest = read('data/manifest.json');
const dataTags = Object.keys(JSON.parse(manifest)).map((id) =>
  `<script type="application/json" id="ss-data-${id}">${safeJson(read(`data/${id}.json`))}</script>`).join('\n');

// Order matters: data, logos and the runtime come first so the page's own
// script finds `dash` and its data ready when it runs inline.
const html = `<title>StatSniper</title>
${fontLink}
${style}
<script type="application/json" id="ss-manifest">${safeJson(manifest)}</script>
${dataTags}
${logoFiles.map((f) => `<script>${read(f)}</script>`).join('\n')}
<script>${read('dash-runtime.js')}</script>
<div id="dash-root">${page}</div>
`;

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'statsniper.html'), html);
console.log(`Wrote dist/statsniper.html (${(html.length / 1024 / 1024).toFixed(2)} MB)`);
