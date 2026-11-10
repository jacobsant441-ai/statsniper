// Alternate lines and totals from Australian bookmakers (The Odds API: alternate_spreads, alternate_totals),
// for one Sydney day, rated with the same margin / total model as the main lines (fetch-odds.js, games.js).
// 2 credits per game (only markets with prices are charged). Writes public/data/altlines.json (private).
// Usage: ODDS_API_KEY=… node scripts/fetch-alt-lines.js "Wed 11 Nov" [--sport=nba|nfl] [--keep=100]
const fs = require('fs');
const path = require('path');

const KEY = process.env.ODDS_API_KEY;
if (!KEY) { console.error('ODDS_API_KEY is not set (put it in front of the command; never in a file).'); process.exit(1); }
const DATA = path.join(__dirname, '..', 'public', 'data');
const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch (e) { return []; } };
const DAY = process.argv[2];
if (!DAY || DAY.startsWith('--')) { console.error('Usage: node scripts/fetch-alt-lines.js "<Sydney day>" [--sport=nba|nfl]'); process.exit(1); }
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
const SPORT = arg('sport', 'nba'), KEEP = Number(arg('keep', 100));
// NBA spread checked 10 Nov on this season's results: margins miss our projection by 14.6 on average (SD), totals 18.6.
const SIG = { nba: { m: 14, t: 19 }, nfl: { m: 13.5, t: 13 } }[SPORT];
const API = 'https://api.the-odds-api.com/v4/sports/' + (SPORT === 'nfl' ? 'americanfootball_nfl' : 'basketball_nba') + '/';
const phi = (z) => { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2); const q = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - q : q; };
const sydDay = (iso) => new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso)).replace(',', '');
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const last = (s) => norm(s).split(' ').pop();
const fmtPt = (p) => (p > 0 ? '+' + p : String(p));

// Our games for the day: names as shown on the site, projected home margin and total.
function ourGames() {
  if (SPORT === 'nba') {
    const pred = read('pred.json');
    return read('games.json').filter((g) => g.date === DAY).map((g) => {
      const p = pred.find((x) => x.id === g.id); if (!p) return null;
      const [A, H] = String(g.matchup || '').split(' @ ');
      return { id: g.id, match: g.matchup, A, H, mh: (p.winner === g.home ? 1 : -1) * Number(p.margin || 0), proj: Number(p.proj_total) };
    }).filter(Boolean);
  }
  return read('nflgames.json').filter((g) => String(g.kick).split(',')[0] === DAY).map((g) => ({ id: g.id, match: g.away_name + ' @ ' + g.home_name, A: g.away_name, H: g.home_name, mh: Number(g.proj_home) - Number(g.proj_away), proj: Number(g.proj_total) }));
}

(async () => {
  const games = ourGames(); if (!games.length) { console.error(`No ${SPORT.toUpperCase()} games with our projections for ${DAY}`); process.exit(1); }
  const r = await fetch(`${API}events?apiKey=${KEY}`); // free
  const left = Number(r.headers.get('x-requests-remaining'));
  const evs = (await r.json()).filter((e) => sydDay(e.commence_time) === DAY && new Date(e.commence_time) > new Date());
  const matched = games.map((g) => { const e = evs.find((x) => last(x.home_team) === last(g.H) && last(x.away_team) === last(g.A)); return e ? { g, e } : null; }).filter(Boolean);
  const cost = matched.length * 2;
  console.log(`${SPORT.toUpperCase()} ${DAY}: ${matched.length} of ${games.length} games at the bookies. At most ${cost} credits; ${left} left now.`);
  if (!matched.length) return;
  if (Number.isFinite(left) && left - cost < KEEP) { console.error(`Stopped: would leave under ${KEEP}.`); process.exit(1); }
  const out = []; let after = left;
  for (const { g, e } of matched) {
    const pr = await fetch(`${API}events/${e.id}/odds?apiKey=${KEY}&regions=au&markets=alternate_spreads,alternate_totals&oddsFormat=decimal`);
    after = Number(pr.headers.get('x-requests-remaining')) || after;
    if (!pr.ok) { console.warn(g.id + ': HTTP ' + pr.status); continue; }
    const j = await pr.json(); const best = {};
    for (const b of j.bookmakers || []) for (const m of b.markets || []) for (const o of m.outcomes || []) {
      if (o.point == null) continue;
      const total = /totals/.test(m.key);
      const side = total ? o.name : last(o.name) === last(g.H) ? g.H : last(o.name) === last(g.A) ? g.A : null; if (!side) continue;
      const k = (total ? 'T|' : 'S|') + side + '|' + o.point;
      const x = (best[k] = best[k] || { total, side, point: Number(o.point), price: 0, books: new Set(), main: false });
      x.books.add(b.title); if (!m.key.startsWith('alternate')) x.main = true;
      if (o.price > x.price) { x.price = o.price; x.book = b.title; }
    }
    const rows = Object.values(best).map((x) => {
      let our;
      if (x.total) { const ov = 100 * phi((g.proj - x.point) / SIG.t); our = /over/i.test(x.side) ? ov : 100 - ov; }
      else { const mT = x.side === g.H ? g.mh : -g.mh; our = 100 * phi((mT + x.point) / SIG.m); }
      if (!Number.isFinite(our)) return null;
      our = Math.round(our * 10) / 10; const implied = Math.round(1000 / x.price) / 10;
      return { sp: SPORT, game: g.id, day: DAY, match: g.match, kick: e.commence_time, market: x.total ? 'Total' : 'Spread', alt: !x.main, pick: x.total ? x.side + ' ' + x.point : x.side + ' ' + fmtPt(x.point), point: x.point, our, price: x.price, book: x.book, books: x.books.size, implied, edge: Math.round((our - implied) * 10) / 10 };
    }).filter(Boolean);
    out.push(...rows);
    console.log(`  ${g.id}: ${rows.length} lines (${rows.filter((x) => x.our >= 75 && x.price >= 1.3).length} at 75%+ and $1.30+)`);
  }
  const keep = read('altlines.json').filter((q) => !(q.sp === SPORT && q.day === DAY) && new Date(q.kick).getTime() > Date.now() - 2 * 86400000);
  fs.writeFileSync(path.join(DATA, 'altlines.json'), JSON.stringify(keep.concat(out)));
  const good = out.filter((x) => x.our >= 75 && x.price >= 1.3).sort((a, b) => b.our - a.our);
  console.log(`altlines.json: ${out.length} lines. Credits left ${after}. At 75%+ paying $1.30+:`);
  good.forEach((x) => console.log(`  ${x.our}%  ${x.pick} (${x.match}) @ $${x.price} ${x.book}  bookie ${x.implied}%, edge ${x.edge >= 0 ? '+' : ''}${x.edge}`));
})().catch((e) => { console.error(e); process.exit(1); });
