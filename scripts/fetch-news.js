// Latest sports news from ESPN's free news feeds (no key): NBA, NFL, Premier League, La Liga, Champions League, UFC.
// Writes public/data/news.json: headline, short summary, photo link, article link, when it was published, and
// the players / teams it is tagged with (ESPN ids, the same ids as our player data). Only headlines and links are
// kept, never full articles. Run by the local server every 30 minutes (scripts/local-server.py); safe to run by hand.
// Usage: node scripts/fetch-news.js
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'data', 'news.json');
const FEEDS = [
  { sp: 'nba', league: 'NBA', path: 'basketball/nba' },
  { sp: 'nfl', league: 'NFL', path: 'football/nfl' },
  { sp: 'fb', league: 'Premier League', path: 'soccer/eng.1' },
  { sp: 'fb', league: 'La Liga', path: 'soccer/esp.1' },
  { sp: 'fb', league: 'Champions League', path: 'soccer/uefa.champions' },
  { sp: 'ufc', league: 'UFC', path: 'mma/ufc' },
];
const KEEP_H = 72; // hours of news to keep

async function getJson(url) {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(url, { headers: { 'User-Agent': 'StatSniper/1.0' } }); if (r.ok) return await r.json(); } catch (e) { /* retry */ }
    await new Promise((res) => setTimeout(res, 1500));
  }
  return null;
}

(async () => {
  const out = [], seen = new Set(); let ok = 0;
  const res = await Promise.all(FEEDS.map((f) => getJson(`https://site.api.espn.com/apis/site/v2/sports/${f.path}/news?limit=40`)));
  res.forEach((j, k) => {
    if (!j) return; ok++;
    const f = FEEDS[k];
    for (const a of j.articles || []) {
      const link = a.links && a.links.web && a.links.web.href; if (!a.headline || !link) continue;
      const id = String(a.id || link); if (seen.has(id)) continue; seen.add(id);
      const cats = a.categories || [];
      out.push({
        id, sp: f.sp, league: f.league, headline: a.headline, desc: a.description && a.description !== a.headline ? String(a.description).slice(0, 220) : '',
        published: a.published || a.lastModified || '', link, video: a.type === 'Media',
        img: (a.images && a.images[0] && a.images[0].url) || '',
        athletes: cats.filter((c) => c.type === 'athlete' && c.athleteId).map((c) => [String(c.athleteId), c.description || '']),
        teams: cats.filter((c) => c.type === 'team' && c.description).map((c) => c.description),
      });
    }
  });
  if (!ok) { console.error('No news feed answered (ESPN down?); news.json left as it was.'); process.exit(1); }
  const cut = Date.now() - KEEP_H * 3600000;
  const rows = out.filter((x) => !x.published || new Date(x.published).getTime() > cut).sort((a, b) => String(b.published).localeCompare(String(a.published)));
  fs.writeFileSync(OUT, JSON.stringify(rows));
  const by = {}; rows.forEach((x) => { by[x.league] = (by[x.league] || 0) + 1; });
  console.log(`news.json: ${rows.length} articles from the last ${KEEP_H}h (${Object.entries(by).map(([k, v]) => k + ' ' + v).join(', ')})`);
})().catch((e) => { console.error(e); process.exit(1); });
