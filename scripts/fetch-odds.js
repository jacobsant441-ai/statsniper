// Australian bookmaker odds from The Odds API (Sportsbet, TAB, Ladbrokes, Neds, PointsBet …),
// matched to our picks, for the Value board.
// Usage: ODDS_API_KEY=… node scripts/fetch-odds.js [--btts] [--props[=points,rebounds,assists,threes,pra]]
//   (reads public/data/fixtures.json, pred.json, games.json, nflgames.json; writes public/data/odds.json)
//
// Quota: the free plan has 500 credits a month. Each sport costs 1 credit per market:
//   football leagues (3) × h2h+totals = 6, NBA and NFL h2h+spreads+totals = 3 each.
//   --btts adds both-teams-to-score for football matches in the next 48 hours (1 credit per match);
//   --props adds 1 credit per NBA game per stat.
// To stay inside 500: a sport with no game in the next 36 hours is skipped (checked on the free
// events list), and odds are bought once per Sydney day (a second run keeps the saved prices; --force overrides).
// The script prints the credits left after each run.
//
// odds.json: one row per bet we have a chance for:
//   {sp, league, game, match, kick, market, pick, our, price, book, implied, edge, books, avg}
//   our = our chance %, price = best decimal price across AU books, implied = 100 / price,
//   edge = our - implied (points), books = how many books priced it, avg = average price.
const fs = require('fs');
const path = require('path');

const KEY = process.env.ODDS_API_KEY;
if (!KEY) { console.error('ODDS_API_KEY is not set: add it to the environment (see RUNBOOK).'); process.exit(1); }
const DATA = path.join(__dirname, '..', 'public', 'data');
const API = 'https://api.the-odds-api.com/v4/sports/';
const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch (e) { return []; } };
const BTTS = process.argv.includes('--btts');
// --props[=points,rebounds,assists,threes,pra]: NBA player props (1 credit per game per stat; points only by default).
const PROPS_ARG = process.argv.find((a) => a.startsWith('--props'));
const PROP_STATS = PROPS_ARG ? (PROPS_ARG.split('=')[1] || 'points').split(',') : [];
const PROP_KEY = { points: ['player_points', 'PTS'], rebounds: ['player_rebounds', 'REB'], assists: ['player_assists', 'AST'], threes: ['player_threes', '3PM'], pra: ['player_points_rebounds_assists', 'PRA'] };
// Normal approximation for spreads and totals: chance a side beats a line, from our projected margin / total.
const phi = (z) => { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2); const q = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - q : q; };
// The line most books use for a market, and the best price at it for one side.
function linePrice(ev, market, side) {
  const pts = {};
  for (const b of ev.bookmakers || []) for (const m of b.markets || []) { if (m.key !== market) continue; for (const o of m.outcomes || []) if (side(o)) (pts[o.point] = pts[o.point] || []).push({ price: o.price, book: b.title }); }
  const best = Object.entries(pts).sort((a, b) => b[1].length - a[1].length)[0]; if (!best) return null;
  const ps = best[1], top = ps.reduce((a, b) => (b.price > a.price ? b : a));
  return { point: Number(best[0]), price: top.price, book: top.book, books: ps.length, avg: Math.round((ps.reduce((t, x) => t + x.price, 0) / ps.length) * 100) / 100 };
}
const fmtPt = (p) => (p > 0 ? '+' + p : String(p));
let left = null, used = null;

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'StatSniper/1.0' } });
  left = r.headers.get('x-requests-remaining') ?? left; used = r.headers.get('x-requests-used') ?? used;
  if (r.status === 404 || r.status === 422) return [];
  if (!r.ok) throw new Error(url.replace(KEY, '…') + ': HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
}
// Change 3, skip a sport with no games: the events list is free (no credits), so check it first and only buy odds
// for a sport with a game starting in the next 36 hours.
const SOON_H = 36;
async function hasGamesSoon(sport) {
  const evs = await get(`${API}${sport}/events?apiKey=${KEY}&dateFormat=iso`);
  const now = Date.now();
  const n = (evs || []).filter((e) => { const t = new Date(e.commence_time).getTime(); return t > now - 2 * 3600000 && t < now + SOON_H * 3600000; }).length;
  if (!n) console.log(`${sport}: no games in the next ${SOON_H} hours, skipped (0 credits)`);
  return n > 0;
}
const odds = (sport, markets) => get(`${API}${sport}/odds?apiKey=${KEY}&regions=au&markets=${markets}&oddsFormat=decimal&dateFormat=iso`);

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\b(fc|cf|ac|as|sc|fk|sk|afc|club|de|cp|rc|vfb|vfl|rb|ssc|the)\b/g, ' ').replace(/\s+/g, ' ').trim();
const ALIAS = { 'inter milan': 'internazionale', 'paris saint germain': 'paris saint germain', 'psg': 'paris saint germain', 'atletico madrid': 'atletico madrid', 'bodo glimt': 'bodo glimt', 'sporting lisbon': 'sporting', 'man utd': 'manchester united', 'man city': 'manchester city', 'spurs': 'tottenham hotspur', 'wolves': 'wolverhampton wanderers' };
const key = (s) => { const n = norm(s); return ALIAS[n] || n; };
const sim = (a, b) => { a = key(a); b = key(b); if (!a || !b) return 0; if (a === b || a.includes(b) || b.includes(a)) return 1; const A = new Set(a.split(' ')); const B = b.split(' ').filter((w) => w.length > 2); return B.filter((w) => A.has(w)).length / Math.max(1, Math.min(A.size, B.length)); };
const pair = (ev, home, away) => sim(ev.home_team, home) + sim(ev.away_team, away);

// Best and average decimal price for one outcome across books.
function priceOf(ev, market, pick) {
  const ps = [];
  for (const b of ev.bookmakers || []) for (const m of b.markets || []) {
    if (m.key !== market) continue;
    for (const o of m.outcomes || []) if (pick(o)) ps.push({ price: o.price, book: b.title });
  }
  if (!ps.length) return null;
  const best = ps.reduce((a, b) => (b.price > a.price ? b : a));
  return { price: best.price, book: best.book, books: ps.length, avg: Math.round((ps.reduce((s, x) => s + x.price, 0) / ps.length) * 100) / 100 };
}
const row = (base, market, pickText, our, p) => {
  if (!p || our == null) return null;
  const implied = Math.round(1000 / p.price) / 10;
  return { ...base, market, pick: pickText, our: Math.round(our * 10) / 10, price: p.price, book: p.book, implied, edge: Math.round((our - implied) * 10) / 10, books: p.books, avg: p.avg };
};

// Change 4, once a day: odds are bought once per Sydney day. A second run the same day keeps the saved prices
// (download the odds dataset first so this check sees them); pass --force to buy fresh ones anyway.
const sydDay = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
const FORCE = process.argv.includes('--force');

(async () => {
  const prev = read('odds.json');
  const last = prev.map((r) => r.fetched).filter(Boolean).sort().pop();
  if (!FORCE && last && sydDay(last) === sydDay(Date.now())) { console.log(`odds: already fetched today (${last}), kept them; 0 credits used. Use --force to fetch again.`); return; }
  const FETCHED = new Date().toISOString();
  const out = [];
  // ---- football: winner, total goals (1.5 / 2.5 / 3.5), and optionally both teams to score
  const fixtures = read('fixtures.json');
  const LG = { 'Premier League': 'soccer_epl', 'La Liga': 'soccer_spain_la_liga', 'Champions League': 'soccer_uefa_champs_league' };
  for (const [league, sport] of Object.entries(LG)) {
    const fx = fixtures.filter((f) => f.league === league); if (!fx.length || !(await hasGamesSoon(sport))) continue;
    const evs = await odds(sport, 'h2h,totals');
    for (const f of fx) {
      const ev = evs.map((e) => [e, pair(e, f.home, f.away)]).sort((a, b) => b[1] - a[1])[0];
      if (!ev || ev[1] < 1.5) continue;
      const e = ev[0], base = { sp: 'fb', league, game: f.id, match: f.home + ' v ' + f.away, kick: e.commence_time };
      const isH = (o) => sim(o.name, f.home) >= 1, isA = (o) => sim(o.name, f.away) >= 1;
      out.push(row(base, 'Winner', f.home + ' win', f.f_home, priceOf(e, 'h2h', isH)), row(base, 'Winner', 'Draw', f.f_draw, priceOf(e, 'h2h', (o) => /draw/i.test(o.name))), row(base, 'Winner', f.away + ' win', f.f_away, priceOf(e, 'h2h', isA)));
      for (const [pt, pOver] of [[1.5, f.p_o15], [2.5, f.p_o25], [3.5, f.p_o35]]) {
        if (pOver == null) continue;
        out.push(row(base, 'Total goals', 'Over ' + pt, pOver, priceOf(e, 'totals', (o) => o.name === 'Over' && Number(o.point) === pt)), row(base, 'Total goals', 'Under ' + pt, 100 - pOver, priceOf(e, 'totals', (o) => o.name === 'Under' && Number(o.point) === pt)));
      }
      if (BTTS && f.p_btts != null && new Date(e.commence_time).getTime() - Date.now() < 48 * 3600000) {
        const be = await get(`${API}${sport}/events/${e.id}/odds?apiKey=${KEY}&regions=au&markets=btts&oddsFormat=decimal`);
        out.push(row(base, 'Both teams to score', 'Both score', f.p_btts, priceOf(be, 'btts', (o) => /yes/i.test(o.name))), row(base, 'Both teams to score', 'Not both', 100 - f.p_btts, priceOf(be, 'btts', (o) => /no/i.test(o.name))));
      }
    }
  }
  // ---- NBA: winner (our blended moneyline chance for our pick)
  const games = read('games.json'), pred = read('pred.json');
  if (pred.length && (await hasGamesSoon('basketball_nba'))) {
    const evs = await odds('basketball_nba', 'h2h,spreads,totals');
    const props = [];
    for (const p of pred) {
      const g = games.find((x) => x.id === p.id); if (!g || !p.ml_pick) continue;
      const [an, hn] = String(g.matchup || '').split(' @ ');
      const ev = evs.map((e) => [e, pair(e, hn, an)]).sort((a, b) => b[1] - a[1])[0];
      if (!ev || ev[1] < 1.5) continue;
      const e = ev[0], base = { sp: 'nba', league: 'NBA', game: p.id, match: g.matchup, kick: e.commence_time };
      const pickName = p.ml_pick === g.home ? hn : an, other = p.ml_pick === g.home ? an : hn;
      out.push(row(base, 'Winner', pickName + ' win', p.ml_final_prob, priceOf(e, 'h2h', (o) => sim(o.name, pickName) >= 1)), row(base, 'Winner', other + ' win', 100 - p.ml_final_prob, priceOf(e, 'h2h', (o) => sim(o.name, other) >= 1)));
      const mh = (p.winner === g.home ? 1 : -1) * Number(p.margin || 0);
      for (const [nm, mT] of [[hn, mh], [an, -mh]]) { const lp = linePrice(e, 'spreads', (o) => sim(o.name, nm) >= 1); if (lp) out.push(row({ ...base, point: lp.point }, 'Spread', nm + ' ' + fmtPt(lp.point), 100 * phi((mT + lp.point) / 14), lp)); }
      for (const side of ['Over', 'Under']) { const lp = linePrice(e, 'totals', (o) => o.name === side); if (lp && p.proj_total != null) { const ov = phi((Number(p.proj_total) - lp.point) / 19); out.push(row({ ...base, point: lp.point }, 'Total points', side + ' ' + lp.point, 100 * (side === 'Over' ? ov : 1 - ov), lp)); } }
      // Player props: the line most books use and the best over / under price.
      for (const st of PROP_STATS) {
        const k = PROP_KEY[st]; if (!k || new Date(e.commence_time).getTime() - Date.now() > 36 * 3600000) continue;
        const pe = await get(`${API}basketball_nba/events/${e.id}/odds?apiKey=${KEY}&regions=au&markets=${k[0]}&oddsFormat=decimal`);
        const by = {};
        for (const b of (pe && pe.bookmakers) || []) for (const m of b.markets || []) for (const o of m.outcomes || []) { const pl = o.description; if (!pl) continue; ((by[pl] = by[pl] || {})[o.point] = by[pl][o.point] || []).push({ side: o.name, price: o.price, book: b.title }); }
        for (const [pl, pts] of Object.entries(by)) {
          const [pt, list] = Object.entries(pts).sort((a, b) => b[1].length - a[1].length)[0];
          const best = (sd) => { const l = list.filter((x) => x.side === sd); return l.length ? l.reduce((a, b) => (b.price > a.price ? b : a)) : null; };
          const ov = best('Over'), un = best('Under');
          props.push({ game: p.id, player: pl, stat: k[1], line: Number(pt), over: ov && ov.price, over_book: ov && ov.book, under: un && un.price, under_book: un && un.book, books: new Set(list.map((x) => x.book)).size, kick: e.commence_time });
        }
      }
    }
    // Season hit rate for each prop line from the players' game logs (pgl): how often he went over / under it.
    if (props.length) {
      const pgl = read('pgl.json');
      const cut = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/\s+/g, ' ').trim();
      const seasonOf = (r) => String(r.g || '').split(';')[0].split(',')[1] || '';
      const cur = pgl.slice(0, 40).map(seasonOf).sort().pop();
      const byName = new Map(pgl.map((r) => [cut(r.player), r]));
      const val = { PTS: (a) => +a[8], REB: (a) => +a[9], AST: (a) => +a[10], '3PM': (a) => +a[11], PRA: (a) => +a[8] + +a[9] + +a[10] };
      for (const q of props) {
        const r = byName.get(cut(q.player)); if (!r || !val[q.stat]) continue;
        const gs = String(r.g || '').split(';').map((x) => x.split(',')).filter((a) => a[1] === cur && +a[7] > 0);
        const v = gs.map(val[q.stat]);
        q.n = v.length; q.over_hit = v.filter((x) => x > q.line).length; q.under_hit = v.filter((x) => x < q.line).length;
        q.over_pct = q.n ? Math.round((100 * q.over_hit) / q.n) : null; q.under_pct = q.n ? Math.round((100 * q.under_hit) / q.n) : null;
        q.l5 = v.slice(0, 5).join(' ');
      }
    }
    if (PROP_STATS.length) { fs.writeFileSync(path.join(DATA, 'props.json'), JSON.stringify(props)); console.log(`props: ${props.length} player lines (${PROP_STATS.join(', ')})`); }
  }
  // ---- NFL: winner (our blended chance for each side)
  const nfl = read('nflgames.json');
  if (nfl.length && (await hasGamesSoon('americanfootball_nfl'))) {
    const evs = await odds('americanfootball_nfl', 'h2h,spreads,totals');
    for (const g of nfl) {
      const ev = evs.map((e) => [e, pair(e, g.home_name, g.away_name)]).sort((a, b) => b[1] - a[1])[0];
      if (!ev || ev[1] < 1.5 || g.home_pct == null) continue;
      const e = ev[0], base = { sp: 'nfl', league: 'NFL', game: g.id, match: g.away_name + ' @ ' + g.home_name, kick: e.commence_time };
      out.push(row(base, 'Winner', g.home_name + ' win', g.home_pct, priceOf(e, 'h2h', (o) => sim(o.name, g.home_name) >= 1)), row(base, 'Winner', g.away_name + ' win', g.away_pct, priceOf(e, 'h2h', (o) => sim(o.name, g.away_name) >= 1)));
      const mh = Number(g.proj_home) - Number(g.proj_away);
      for (const [nm, mT] of [[g.home_name, mh], [g.away_name, -mh]]) { const lp = linePrice(e, 'spreads', (o) => sim(o.name, nm) >= 1); if (lp && Number.isFinite(mh)) out.push(row({ ...base, point: lp.point }, 'Spread', nm + ' ' + fmtPt(lp.point), 100 * phi((mT + lp.point) / 13.5), lp)); }
      for (const side of ['Over', 'Under']) { const lp = linePrice(e, 'totals', (o) => o.name === side); if (lp && g.proj_total != null) { const ov = phi((Number(g.proj_total) - lp.point) / 13); out.push(row({ ...base, point: lp.point }, 'Total points', side + ' ' + lp.point, 100 * (side === 'Over' ? ov : 1 - ov), lp)); } }
    }
  }
  // ---- UFC: fight winner and total rounds (Australian books; the Betfair exchange is left out because its prices are
  // before commission). Method of victory (KO / submission / decision) isn't offered through The Odds API.
  // Our chance for each fighter = 70% market (these live prices, margin removed) + 30% record model (ufcfights a_model);
  // scripts/ufc-reprice.js then writes the same numbers back into the fight cards. Looks up to 7 days ahead
  // (fight week), 2 credits a run, only when a card is coming up.
  const ufc = read('ufcfights.json').filter((f) => f.status !== 'Final' && f.a && f.b);
  if (ufc.length) {
    const evl = await get(`${API}mma_mixed_martial_arts/events?apiKey=${KEY}&dateFormat=iso`);
    const soon = (evl || []).filter((e) => { const t = new Date(e.commence_time).getTime(); return t > Date.now() - 2 * 3600000 && t < Date.now() + 7 * 86400000; });
    if (!soon.length) console.log('mma: no fights in the next 7 days, skipped (0 credits)');
    else {
      const evs = (await odds('mma_mixed_martial_arts', 'h2h,totals')).map((e) => ({ ...e, bookmakers: (e.bookmakers || []).filter((b) => !/betfair_ex/.test(b.key)) }));
      const cutN = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\(c\)/g, '').replace(/[^a-z ]/g, ' ').trim().split(/\s+/).pop();
      for (const f of ufc) {
        const e = evs.find((x) => [x.home_team, x.away_team].map(cutN).sort().join('|') === [f.a, f.b].map(cutN).sort().join('|')); if (!e) continue;
        const isA = (o) => cutN(o.name) === cutN(f.a), isB = (o) => cutN(o.name) === cutN(f.b);
        const pa = priceOf(e, 'h2h', isA), pb = priceOf(e, 'h2h', isB); if (!pa || !pb) continue;
        let ma = 1 / pa.avg, mb = 1 / pb.avg; const sm = ma + mb; ma = (100 * ma) / sm; mb = 100 - ma;
        const aOur = f.a_model != null ? 0.7 * ma + 0.3 * Number(f.a_model) : ma;
        const base = { sp: 'ufc', league: 'UFC', game: f.id, match: String(f.a).replace(/\s*\(c\)/, '') + ' vs ' + String(f.b).replace(/\s*\(c\)/, ''), kick: e.commence_time, mkt_a: Math.round(ma * 10) / 10 };
        out.push(row(base, 'Winner', String(f.a).replace(/\s*\(c\)/, '') + ' win', aOur, pa), row(base, 'Winner', String(f.b).replace(/\s*\(c\)/, '') + ' win', 100 - aOur, pb));
        // total rounds: no model of our own yet, so "our" is the market's fair chance (margin removed)
        const pts = [...new Set((e.bookmakers || []).flatMap((b) => (b.markets || []).filter((m) => m.key === 'totals').flatMap((m) => m.outcomes.map((o) => Number(o.point)))))];
        for (const pt of pts) {
          const ov = priceOf(e, 'totals', (o) => o.name === 'Over' && Number(o.point) === pt), un = priceOf(e, 'totals', (o) => o.name === 'Under' && Number(o.point) === pt);
          if (!ov || !un) continue;
          const fo = (100 / ov.avg) / (1 / ov.avg + 1 / un.avg);
          out.push(row({ ...base, point: pt }, 'Total rounds', 'Over ' + pt + ' rounds', fo, ov), row({ ...base, point: pt }, 'Total rounds', 'Under ' + pt + ' rounds', 100 - fo, un));
        }
      }
      console.log(`mma: ${ufc.length} fights on file, ${out.filter((r) => r && r.sp === 'ufc' && r.market === 'Winner').length / 2} priced`);
    }
  }
  const rows = out.filter(Boolean).map((r) => ({ ...r, fetched: FETCHED })).filter((r) => new Date(r.kick).getTime() > Date.now() - 2 * 3600000).sort((a, b) => b.edge - a.edge);
  fs.writeFileSync(path.join(DATA, 'odds.json'), JSON.stringify(rows));
  const val = rows.filter((r) => r.our >= 65 && r.edge >= 5).length;
  console.log(`odds: ${rows.length} priced bets, ${val} on the Value board (our chance 65%+ and 5+ points above the odds). Credits used ${used}, left ${left}.`);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
