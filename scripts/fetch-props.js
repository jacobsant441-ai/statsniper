// Australian bookmaker NBA player prop prices for ONE Sydney day only (The Odds API), so the credit cost
// stays small and predictable: 1 credit per game per stat (points, rebounds, assists, threes = 4 a game).
// Checks the credits left first (the events list is free) and stops if this run would leave fewer than
// --keep (default 100). Writes public/data/props.json (private: never committed or published), keeping
// every line each player is offered at (best over / under price across AU books at each line).
// Usage: ODDS_API_KEY=… node scripts/fetch-props.js "Wed 11 Nov" [--stats=points,rebounds] [--keep=100]
//          [--games=ORL-SAC,OKC-POR]  only these games (other games' saved lines for the day are kept)
//          [--alt]  also alternate lines (20+, 25+ …) where the AU books offer them (1 credit per game per stat more)
const fs = require('fs');
const path = require('path');

const KEY = process.env.ODDS_API_KEY;
if (!KEY) { console.error('ODDS_API_KEY is not set (put it in front of the command; never in a file).'); process.exit(1); }
const DATA = path.join(__dirname, '..', 'public', 'data');
const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch (e) { return []; } };
const DAY = process.argv[2];
if (!DAY || DAY.startsWith('--')) { console.error('Usage: node scripts/fetch-props.js "<Sydney day>" [--stats=points,rebounds] [--keep=100]'); process.exit(1); }
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
const STATS = arg('stats', 'points,rebounds,assists,threes').split(',');
const KEEP = Number(arg('keep', 100));
const MK = { points: ['player_points', 'PTS'], rebounds: ['player_rebounds', 'REB'], assists: ['player_assists', 'AST'], threes: ['player_threes', '3PM'] };
const ALT = process.argv.includes('--alt');
const ONLY = arg('games', '').split(',').filter(Boolean);
const MKEYS = STATS.flatMap((st) => (MK[st] ? (ALT ? [MK[st][0], MK[st][0] + '_alternate'] : [MK[st][0]]) : []));
const statOf = (key) => { const x = Object.values(MK).find((m) => key === m[0] || key === m[0] + '_alternate'); return x && x[1]; };
const API = 'https://api.the-odds-api.com/v4/sports/basketball_nba/';
const sydDay = (iso) => new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso)).replace(',', '');
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

(async () => {
  const games = read('games.json').filter((g) => g.date === DAY && (!ONLY.length || ONLY.includes(g.id)));
  if (!games.length) { console.error('No NBA games for ' + DAY + ' in games.json'); process.exit(1); }
  const r = await fetch(`${API}events?apiKey=${KEY}`); // free
  if (!r.ok) { console.error('events list failed: HTTP ' + r.status); process.exit(1); }
  const left = Number(r.headers.get('x-requests-remaining'));
  const evs = (await r.json()).filter((e) => sydDay(e.commence_time) === DAY && new Date(e.commence_time) > new Date());
  const matched = games.map((g) => { const [an, hn] = String(g.matchup || '').split(' @ '); const e = evs.find((x) => norm(x.home_team).includes(norm(hn).split(' ').pop()) && norm(x.away_team).includes(norm(an).split(' ').pop())); return e ? { g, e } : null; }).filter(Boolean);
  const cost = matched.length * MKEYS.length;
  console.log(`${DAY}: ${games.length} games, ${matched.length} found at the bookies. Cost ${cost} credits; ${left} left now.`);
  if (!matched.length) return;
  if (Number.isFinite(left) && left - cost < KEEP) { console.error(`Stopped: this would leave ${left - cost}, under the ${KEEP} kept in reserve. Use fewer --stats or a lower --keep.`); process.exit(1); }
  const markets = MKEYS.join(',');
  const out = []; let after = left;
  for (const { g, e } of matched) {
    const pr = await fetch(`${API}events/${e.id}/odds?apiKey=${KEY}&regions=au&markets=${markets}&oddsFormat=decimal`);
    after = Number(pr.headers.get('x-requests-remaining')) || after;
    if (!pr.ok) { console.warn(g.id + ': HTTP ' + pr.status); continue; }
    const j = await pr.json(); const by = {};
    for (const b of j.bookmakers || []) for (const m of b.markets || []) {
      const stc = statOf(m.key); if (!stc) continue; const st = [m.key, stc];
      for (const o of m.outcomes || []) { if (!o.description || o.point == null) continue; const k = o.description + '|' + st[1] + '|' + o.point; const x = (by[k] = by[k] || { player: o.description, stat: st[1], line: Number(o.point), books: new Set() }); x.books.add(b.title); const side = /over/i.test(o.name) ? 'over' : 'under'; if (!x[side] || o.price > x[side]) { x[side] = o.price; x[side + '_book'] = b.title; } }
    }
    const rows = Object.values(by).map((x) => ({ game: g.id, day: DAY, player: x.player, stat: x.stat, line: x.line, over: x.over || null, over_book: x.over_book || '', under: x.under || null, under_book: x.under_book || '', books: x.books.size, kick: e.commence_time }));
    out.push(...rows); console.log(`  ${g.id}: ${rows.length} lines`);
  }
  const fetchedIds = new Set(matched.map((x) => x.g.id));
  const keep = read('props.json').filter((q) => q.day && (q.day !== DAY || (ONLY.length && !fetchedIds.has(q.game))));
  fs.writeFileSync(path.join(DATA, 'props.json'), JSON.stringify(keep.concat(out)));
  console.log(`props.json: ${out.length} lines for ${DAY}. Credits left: ${after}.`);
})().catch((e) => { console.error(e); process.exit(1); });
