// NFL prop finder: our chance for every bookmaker player line saved in props.json (sp 'nfl', from
// fetch-props.js --sport=nfl), from each player's game logs (nflp.json). Same idea as the NBA prop finder:
// season average (topped up from last season early on) blended with recent form, then a chance from a bell
// curve (yards, catches, attempts) or a count model (touchdowns, interceptions).
// Writes the rated lines into propbook.json (private) next to the NBA ones.
//
// Usage: node scripts/nfl-prop-finder.js            rate every saved NFL line for games still to come
//        node scripts/nfl-prop-finder.js --backtest  replay this season week by week using only earlier games
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'public', 'data');
const read = (f, d = []) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch (e) { return d; } };
const SEASON = '2026', LAST = '2025';
// stat code -> log columns added together, words, and how the chance is worked out
const STATS = {
  PYD: { c: ['passingYards'], word: 'passing yards' }, PTD: { c: ['passingTouchdowns'], word: 'passing TDs', pois: true },
  CMP: { c: ['completions'], word: 'completions' }, PATT: { c: ['passingAttempts'], word: 'pass attempts' },
  INT: { c: ['interceptions'], word: 'interceptions thrown', pois: true, pos: ['QB'] }, PLONG: { c: ['longPassing'], word: 'longest completion' },
  PRYD: { c: ['passingYards', 'rushingYards'], word: 'pass + rush yards' },
  RYD: { c: ['rushingYards'], word: 'rushing yards' }, RATT: { c: ['rushingAttempts'], word: 'rush attempts' }, RLONG: { c: ['longRushing'], word: 'longest rush' },
  RTD: { c: ['rushingTouchdowns'], word: 'rushing TDs', pois: true },
  RECYD: { c: ['receivingYards'], word: 'receiving yards' }, REC: { c: ['receptions'], word: 'receptions' }, RECLONG: { c: ['longReception'], word: 'longest reception' },
  RRYD: { c: ['rushingYards', 'receivingYards'], word: 'rush + rec yards' },
  DINT: { c: ['interceptions'], word: 'interceptions', pois: true, def: true },
  ATD: { c: ['rushingTouchdowns', 'receivingTouchdowns'], word: 'anytime TD', pois: true, yes: true },
  TDS: { c: ['rushingTouchdowns', 'receivingTouchdowns'], word: 'TDs', pois: true },
};
const CFG = { form: 0.3, calib: 0.9, pick: 75, med: Number(process.env.MED || 0), td: Number(process.env.TD || 0.8), dint: Number(process.env.DINT || 0.4), wid: Number(process.env.WID || 1.25) };
// Backtest 10 Nov (Sep-Nov 2026): yards stats ran too sure of themselves, so their spread is 25% wider (75%+ yards
// lines then hit 77-80%); leaning on the median game (med) did not help, so it is off. Rushing / anytime
// touchdowns and defensive interceptions are rare and a hot start overstates them, so their rate is scaled down.
const SKEW = new Set(['RYD', 'RECYD', 'RRYD', 'RLONG', 'RECLONG']);
// Interceptions thrown: a few clean games are mostly luck, so pull toward a typical QB (0.7 a game) as if he had
// played PRIOR_N more games at that rate.
const PRIOR = { INT: [0.7, Number(process.env.PRIOR_N || 6)] };
const SHRINK = { ATD: 'td', TDS: 'td', RTD: 'td', DINT: 'dint' }; // QB passing TDs were already right
const median = (a) => { const b = a.slice().sort((x, y) => x - y); const m = b.length >> 1; return b.length ? (b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2) : 0; };
// Backtest only: skip players whose average is below this (bookies don't post a line for a receiver's rushing).
const MIN_AVG = { RYD: 25, RATT: 6, RLONG: 8, RTD: 0.2, RECYD: 20, REC: 2, RECLONG: 10, RRYD: 30, PYD: 120, CMP: 10, PATT: 15, PLONG: 20, PRYD: 120, PTD: 0.5, INT: 0, ATD: 0.2, TDS: 0.2, DINT: 0.15 };
const DEF = new Set(['LB', 'CB', 'S', 'DT', 'DE', 'DB']);

const ncdf = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)); const d = 0.3989423 * Math.exp(-x * x / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
const poisAtLeast = (k, mu) => { let p = 0, t = Math.exp(-mu); for (let i = 0; i < k; i++) { p += t; t *= mu / (i + 1); } return Math.max(0, 1 - p); };
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const sd = (a) => { const m = avg(a); return Math.sqrt(avg(a.map((x) => (x - m) ** 2))); };
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/\s+/g, ' ').trim();

function loadPlayers() {
  return read('nflp.json').map((r) => {
    const cols = String(r.cols || '').split(',');
    const games = String(r.g || '').split(';').filter(Boolean).map((s) => {
      const a = s.split(','); const v = {}; cols.forEach((c, i) => { const x = Number(a[7 + i]); if (a[7 + i] !== '-' && Number.isFinite(x)) v[c] = x; });
      return { date: a[0], season: a[1], team: a[2], opp: a[3], ha: a[4], v };
    }).sort((x, y) => (x.date < y.date ? 1 : -1));
    return { pid: r.pid, player: r.player, team: r.team, pos: r.pos, status: r.status, cols, games };
  });
}
const has = (p, st) => STATS[st].c.every((c) => p.cols.includes(c)) && (!STATS[st].def || DEF.has(p.pos)) && (!STATS[st].pos || STATS[st].pos.includes(p.pos)) && (STATS[st].def || !DEF.has(p.pos));
const valOf = (g, st) => { const xs = STATS[st].c.map((c) => g.v[c]); return xs.every((x) => x === undefined) ? undefined : xs.reduce((a, b) => a + (b || 0), 0); };

// Our chance he reaches k (k = line rounded up: over 64.5 means 65+), using only games before `before`.
function project(p, st, k, before) {
  const gs = p.games.filter((g) => g.date < before && valOf(g, st) !== undefined);
  const cur = gs.filter((g) => g.season === SEASON), last = gs.filter((g) => g.season === LAST);
  if (cur.length < 3) return null;
  const val = (g) => valOf(g, st);
  const wCur = Math.min(1, cur.length / 8);
  const seasonAvg = wCur * avg(cur.map(val)) + (1 - wCur) * (last.length ? avg(last.map(val)) : avg(cur.map(val)));
  const l3 = avg(cur.slice(0, 3).map(val));
  let mu = (1 - CFG.form) * seasonAvg + CFG.form * l3;
  if (SKEW.has(st)) mu = (1 - CFG.med) * mu + CFG.med * median(cur.slice(0, 10).map(val));
  if (SHRINK[st]) mu *= CFG[SHRINK[st]];
  if (PRIOR[st]) mu = (mu * cur.length + PRIOR[st][0] * PRIOR[st][1]) / (cur.length + PRIOR[st][1]);
  const recent = gs.slice(0, 12).map(val);
  let pr;
  if (STATS[st].pois) pr = poisAtLeast(k, Math.max(mu, 0.02));
  else { const spread = Math.max(sd(recent), Math.sqrt(Math.max(mu, 1)) * 1.2, /YD|LONG/.test(st) ? 12 : 1.5); pr = 1 - ncdf((k - 0.5 - mu) / (spread * (SKEW.has(st) ? CFG.wid : 1))); }
  pr = 0.5 + CFG.calib * (pr - 0.5);
  const hit = cur.filter((g) => val(g) >= k).length;
  return { chance: Math.round(pr * 1000) / 10, hit, n: cur.length, mu, seasonAvg, l3 };
}

function backtest() {
  const players = loadPlayers();
  const dates = [...new Set(players.flatMap((p) => p.games.filter((g) => g.season === SEASON).map((g) => g.date)))].sort();
  const bands = {}, per = {}; let br = 0, n = 0;
  const band = (c) => (c >= 90 ? '90+' : c >= 80 ? '80-90' : c >= 70 ? '70-80' : c >= 60 ? '60-70' : '<60');
  for (const d of dates) for (const p of players) {
    const g = p.games.find((x) => x.date === d); if (!g) continue;
    for (const st in STATS) {
      if (!has(p, st) || valOf(g, st) === undefined) continue;
      const prior = p.games.filter((x) => x.date < d && x.season === SEASON).map((x) => valOf(x, st)).filter((x) => x !== undefined);
      if (prior.length < 3 || avg(prior) < (MIN_AVG[st] || 0)) continue; // bookies only post lines for regulars
      // lines like the bookies post: around his average, and alternates below it
      const a = avg(prior); const ks = STATS[st].yes ? [1] : [...new Set([0.5, 0.75, 1].map((f) => Math.max(1, Math.round(a * f))))];
      for (const k of ks) {
        const o = project(p, st, k, d); if (!o) continue; const y = valOf(g, st) >= k ? 1 : 0;
        const b = (bands[band(o.chance)] = bands[band(o.chance)] || [0, 0, 0]); b[0]++; b[1] += y; b[2] += o.chance;
        const s = (per[st] = per[st] || { n: 0, h: 0, said: 0, p: 0, ph: 0 }); s.n++; s.h += y; s.said += o.chance; if (o.chance >= CFG.pick) { s.p++; s.ph += y; }
        br += (o.chance / 100 - y) ** 2; n++;
      }
    }
  }
  console.log(`NFL backtest ${dates[0]} to ${dates[dates.length - 1]}, settings ${JSON.stringify(CFG)}`);
  ['90+', '80-90', '70-80', '60-70', '<60'].forEach((k) => { const b = bands[k]; if (b) console.log(`  ${k.padEnd(6)} ${b[1]}/${b[0]} = ${Math.round((100 * b[1]) / b[0])}%  (said ${Math.round(b[2] / b[0])}%)`); });
  console.log(`Brier ${(br / n).toFixed(4)} over ${n} lines. By stat (hit vs said, and 75%+):`);
  Object.entries(per).forEach(([st, x]) => console.log(`  ${st.padEnd(7)} ${String(x.n).padStart(5)}  hit ${Math.round((100 * x.h) / x.n)}% said ${Math.round(x.said / x.n)}%  75%+: ${x.ph}/${x.p} = ${x.p ? Math.round((100 * x.ph) / x.p) : '-'}%`));
}

function live() {
  const players = loadPlayers(); const byName = new Map(players.map((p) => [norm(p.player), p]));
  const tr = read('troster.json').filter((t) => t.sp === 'nfl');
  const out = new Set(tr.flatMap((t) => (t.inj || []).filter((i) => /out|injured reserve|ir\b/i.test(i[3])).map((i) => String(i[0]))));
  const now = Date.now();
  const lines = read('props.json').filter((q) => q.sp === 'nfl' && STATS[q.stat] && (!q.kick || new Date(q.kick).getTime() > now - 6 * 3600000));
  const book = [];
  for (const q of lines) {
    const p = byName.get(norm(q.player)); if (!p || out.has(String(p.pid)) || !has(p, q.stat)) continue;
    const [A, H] = q.game.split('-'); if (p.team !== A && p.team !== H) continue;
    const k = Math.floor(q.line) + 1; const o = project(p, q.stat, k, '9999'); if (!o || o.n < 5) continue; // 5+ games this season
    const opp = p.team === A ? H : A;
    for (const [side, price, bk] of [['over', q.over, q.over_book], ['under', q.under, q.under_book]]) {
      if (!price) continue;
      const chance = side === 'over' ? o.chance : Math.round((100 - o.chance) * 10) / 10;
      const pick = STATS[q.stat].yes ? `${p.player} ${side === 'over' ? 'anytime TD' : 'no TD'}` : `${p.player} ${side} ${q.line} ${STATS[q.stat].word}`;
      book.push({ sp: 'nfl', main: q.main, kick: q.kick, pid: p.pid, game: q.game, day: q.day, player: p.player, team: p.team, opp, stat: q.stat, line: q.line, side, pick, chance, price, book: bk, implied: Math.round(1000 / price) / 10, edge: Math.round((chance - 100 / price) * 10) / 10, hit: (side === 'over' ? o.hit : o.n - o.hit) + '/' + o.n, avg: Math.round(o.seasonAvg * 10) / 10, l5: Math.round(o.l3 * 10) / 10, proj: Math.round(o.mu * 10) / 10, why: chance - 100 / price > 20 ? ['big gap to the bookie: check team news'] : [] });
    }
  }
  book.sort((a, b) => b.chance - a.chance);
  const keep = read('propbook.json').filter((r) => (r.sp || 'nba') !== 'nfl');
  fs.writeFileSync(path.join(DATA, 'propbook.json'), JSON.stringify(keep.concat(book)));
  const good = book.filter((r) => r.chance >= CFG.pick && r.price >= 1.3);
  console.log(`NFL: ${lines.length} lines saved, ${book.length} sides rated; ${good.length} at ${CFG.pick}%+ paying $1.30+ (propbook.json, private):`);
  good.slice(0, 30).forEach((r) => console.log(`  ${r.chance}%  ${r.pick} @ $${r.price} ${r.book} (${r.game} ${r.day}) avg ${r.avg}, last 3 ${r.l5}, hit ${r.hit}`));
}

if (process.argv[2] === '--backtest') backtest(); else live();
