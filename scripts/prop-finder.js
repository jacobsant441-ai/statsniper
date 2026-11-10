// NBA prop finder: our own chance that a player reaches a milestone (points 10+/15+/20+/25+/30+,
// rebounds 4+/6+/8+/10+, assists 3+/5+/7+, threes 1+/2+/3+) in a coming game, from his game logs
// (pgl.json). The player profiles are not touched; this only reads the same logs.
//
// Expected value = season average (filled from last season early on) blended with recent form, then
// nudged by: home/away split, his record against this opponent, and how much this opponent gives up
// to his position this season (all pulled toward "no effect" when the sample is small). Chance =
// normal curve around that expected value using his own game-to-game spread, then a calibration
// factor fitted on the backtest (pulls the chance toward 50% if the raw chances run too hot).
//
// Usage:
//   node scripts/prop-finder.js "<Sydney day>"     e.g. "Wed 11 Nov": writes public/data/propfind.json
//   node scripts/prop-finder.js --backtest          replays every game day this season using only
//                                                   games played before it, and reports how often
//                                                   each chance band actually hit.
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'public', 'data');
const read = (f, d = []) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch (e) { return d; } };
const SEASON = '2026-27', LAST = '2025-26';
// ks: the milestones our own plays use; every stat is also rated at each bookmaker line (props.json).
// bin: yes/no stats (double / triple double): chance = his blended rate, not a normal curve.
const STATS = {
  PTS: { ks: [10, 15, 20, 25, 30], word: 'points' }, REB: { ks: [4, 6, 8, 10], word: 'rebounds' }, AST: { ks: [3, 5, 7], word: 'assists' }, '3PM': { ks: [1, 2, 3], word: 'threes' },
  STL: { ks: [1, 2], word: 'steals' }, BLK: { ks: [1, 2], word: 'blocks' }, SB: { ks: [1, 2, 3], word: 'steals + blocks' }, TOV: { ks: [1, 2, 3, 4], word: 'turnovers' },
  '2PM': { ks: [3, 5, 7, 9], word: 'two-pointers' }, PRA: { ks: [15, 20, 25, 30, 35, 40], word: 'pts + reb + ast' }, PR: { ks: [10, 15, 20, 25, 30, 35], word: 'pts + reb' },
  PA: { ks: [10, 15, 20, 25, 30, 35], word: 'pts + ast' }, RA: { ks: [5, 8, 10, 12, 15], word: 'reb + ast' }, DD: { ks: [1], word: 'double-double', bin: true }, TD: { ks: [1], word: 'triple-double', bin: true },
};
const OWN = ['PTS', 'REB', 'AST', '3PM'];
const statVals = (v) => { const pts = +v[8] || 0, reb = +v[9] || 0, ast = +v[10] || 0, tpm = +v[11] || 0, stl = +v[12] || 0, blk = +v[13] || 0, to = +v[14] || 0, fgm = +v[15] || 0; const ten = [pts, reb, ast, stl, blk].filter((x) => x >= 10).length;
  return { PTS: pts, REB: reb, AST: ast, '3PM': tpm, STL: stl, BLK: blk, SB: stl + blk, TOV: to, '2PM': Math.max(0, fgm - tpm), PRA: pts + reb + ast, PR: pts + reb, PA: pts + ast, RA: reb + ast, DD: ten >= 2 ? 1 : 0, TD: ten >= 3 ? 1 : 0 }; };
// Settings the backtest checks (kept only if they help).
// Backtest 10 Nov (12 days, ~2,400 plays): home/away, vs-opponent and opponent-by-position each made the
// chances LESS accurate this early in the season, so they are shown as reasons but do not move the chance.
// Re-test them in December (set to true and run --backtest).
const CFG = { form: 0.35, venue: false, vsOpp: false, oppPos: false, calib: 0.95, pick: 75, minMin: 18, pois: (process.env.POIS || 'STL,BLK,SB,3PM,TOV').split(',') };
// Low-count stats are a count, not a bell curve: Poisson chance instead. Backtest 10 Nov: blocks at 75%+ went from
// 68% to 81% hit, steals 70% to 73%; threes and turnovers slightly better too.
const poisAtLeast = (k, mu) => { let p = 0, t = Math.exp(-mu); for (let i = 0; i < k; i++) { p += t; t *= mu / (i + 1); } return Math.max(0, 1 - p); };
const BIN_BASE = { DD: 0.08, TD: 0.01 }; // league-wide rate a yes/no is pulled toward

const ncdf = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)); const d = 0.3989423 * Math.exp(-x * x / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const sd = (a) => { const m = avg(a); return Math.sqrt(avg(a.map((x) => (x - m) ** 2))); };
const posOf = (p) => String(p || 'G')[0];

// All logs, parsed once: {pid, player, team, pos, games: [{date, season, team, opp, ha, min, v: {PTS..}}] newest first}
function loadPlayers() {
  return read('pgl.json').map((r) => ({
    pid: r.pid, player: r.player, team: r.team, pos: posOf(r.pos),
    games: String(r.g || '').split(';').filter(Boolean).map((s) => { const v = s.split(','); return { date: v[0], season: v[1], team: v[2], opp: v[3], ha: v[4], min: Number(v[7]) || 0, po: v[21] === '1', v: statVals(v) }; }).filter((g) => !g.po && g.min > 0),
  }));
}

// Opponent factor by position: what each team allowed per game to G/F/C this season vs league average.
function oppTable(players, before) {
  const T = {}, L = {};
  for (const p of players) for (const g of p.games) {
    if (g.season !== SEASON || g.date >= before) continue;
    const k = g.opp + '|' + p.pos + '|' + g.date; // one opponent-game per row
    const t = (T[g.opp] = T[g.opp] || {}); const s = (t[p.pos] = t[p.pos] || { games: new Set(), sum: Object.fromEntries(Object.keys(STATS).map((x) => [x, 0])) });
    s.games.add(g.date); for (const st in STATS) s.sum[st] += g.v[st];
    const l = (L[p.pos] = L[p.pos] || { games: new Set(), sum: Object.fromEntries(Object.keys(STATS).map((x) => [x, 0])) }); l.games.add(g.opp + g.date); for (const st in STATS) l.sum[st] += g.v[st];
    void k;
  }
  return (opp, pos, st) => {
    const s = T[opp] && T[opp][pos], l = L[pos]; if (!s || !l || !l.games.size) return { f: 1, n: 0 };
    const n = s.games.size, mine = s.sum[st] / n, lg = l.sum[st] / l.games.size; if (!lg) return { f: 1, n };
    const w = n / (n + 8); return { f: 1 + w * (mine / lg - 1), n, raw: mine / lg };
  };
}

// Our chance for one player, stat and milestone in a game against `opp` at home/away `ha`, using only games before `before`.
function project(p, st, opp, ha, before, opp3, ks) {
  const gs = p.games.filter((g) => g.date < before);
  const cur = gs.filter((g) => g.season === SEASON), last = gs.filter((g) => g.season === LAST);
  if (cur.length < 3) return null;
  const recent = gs.slice(0, 20);
  if (avg(cur.slice(0, 5).map((g) => g.min)) < CFG.minMin) return null;
  const val = (g) => g.v[st];
  // base: this season, topped up with last season while the sample is small
  const wCur = Math.min(1, cur.length / 15);
  const seasonAvg = wCur * avg(cur.map(val)) + (1 - wCur) * (last.length ? avg(last.map(val)) : avg(cur.map(val)));
  const l5 = avg(cur.slice(0, 5).map(val));
  let mu = (1 - CFG.form) * seasonAvg + CFG.form * l5;
  const notes = [];
  // home/away split (this season and last), pulled toward no effect
  {
    const pool = gs.filter((g) => g.season === SEASON || g.season === LAST);
    const side = pool.filter((g) => g.ha === ha), all = avg(pool.map(val));
    if (side.length >= 5 && all > 0) { const w = side.length / (side.length + 25); const f = 1 + w * (avg(side.map(val)) / all - 1); if (CFG.venue) mu *= f; if (Math.abs(f - 1) > 0.04) notes.push(`${f > 1 ? 'better' : 'worse'} ${ha === 'H' ? 'at home' : 'on the road'} (${avg(side.map(val)).toFixed(1)})`); }
  }
  // record against this opponent (last 3 seasons)
  {
    const vs = gs.filter((g) => g.opp === opp).slice(0, 8), all = avg(recent.map(val));
    if (vs.length >= 2 && all > 0) { const w = vs.length / (vs.length + 8); const f = 1 + w * (avg(vs.map(val)) / all - 1); if (CFG.vsOpp) mu *= f; if (Math.abs(f - 1) > 0.04) notes.push(`${avg(vs.map(val)).toFixed(1)} a game in ${vs.length} vs ${opp}`); }
  }
  // what this opponent gives up to his position
  if (opp3) { const o = opp3(opp, p.pos, st); if (CFG.oppPos) mu *= o.f; if (o.raw && Math.abs(o.raw - 1) > 0.08 && o.n >= 4) notes.push(`${opp} allow ${Math.round(Math.abs(o.raw - 1) * 100)}% ${o.raw > 1 ? 'more' : 'less'} ${STATS[st].word} to ${{ G: 'guards', F: 'forwards', C: 'centres' }[p.pos]}`); }
  const big = ['PTS', 'PRA', 'PR', 'PA'].includes(st);
  const spread = Math.max(sd(recent.map(val)), Math.sqrt(Math.max(mu, 0.5)) * 0.9, big ? 4 : 1);
  const out = (ks || STATS[st].ks).map((k) => {
    // yes/no: his blended rate, pulled toward the league rate by 3 imaginary games
    let pr = STATS[st].bin ? (mu * cur.length + BIN_BASE[st] * 3) / (cur.length + 3) : CFG.pois.includes(st) ? poisAtLeast(k, mu) : 1 - ncdf((k - 0.5 - mu) / spread);
    pr = 0.5 + CFG.calib * (pr - 0.5);
    const hit = cur.filter((g) => val(g) >= k).length;
    return { k, chance: Math.round(pr * 1000) / 10, hit, n: cur.length };
  });
  return { mu, seasonAvg, l5, out, notes };
}

// The play for a player and stat: the highest milestone we give CFG.pick% or more.
function bestLine(pr) { const ok = pr.out.filter((o) => o.chance >= CFG.pick); return ok.length ? ok[ok.length - 1] : null; }

function backtest(QUIET) {
  const players = loadPlayers();
  const dates = [...new Set(players.flatMap((p) => p.games.filter((g) => g.season === SEASON).map((g) => g.date)))].sort().filter((d) => d >= '2026-10-27');
  const bands = {}, picks = [], top = [], baseBands = {}, per = {}; let br = 0, brN = 0;
  const band = (c) => (c >= 90 ? '90+' : c >= 80 ? '80-90' : c >= 70 ? '70-80' : c >= 60 ? '60-70' : '<60');
  for (const d of dates) {
    const opp3 = oppTable(players, d); const day = [];
    for (const p of players) {
      const g = p.games.find((x) => x.date === d); if (!g) continue;
      for (const st in STATS) {
        const pr = project(p, st, g.opp, g.ha, d, opp3); if (!pr) continue;
        pr.out.forEach((o) => { const ps = (per[st] = per[st] || { n: 0, hit: 0, said: 0, br: 0, p: 0, ph: 0 }); const y = g.v[st] >= o.k ? 1 : 0; ps.n++; ps.hit += y; ps.said += o.chance / 100; ps.br += (o.chance / 100 - y) ** 2; if (o.chance >= CFG.pick) { ps.p++; ps.ph += y; }
          const b = (bands[band(o.chance)] = bands[band(o.chance)] || [0, 0, 0]); b[0]++; b[1] += g.v[st] >= o.k ? 1 : 0; b[2] += o.chance / 100; br += (o.chance / 100 - (g.v[st] >= o.k ? 1 : 0)) ** 2; brN++;
          const sr = (100 * (o.hit + 1)) / (o.n + 2); const bb = (baseBands[band(sr)] = baseBands[band(sr)] || [0, 0]); bb[0]++; bb[1] += g.v[st] >= o.k ? 1 : 0; });
        const bl = bestLine(pr); if (bl) { const hit = g.v[st] >= bl.k; picks.push(hit); day.push({ c: bl.chance, hit }); }
      }
    }
    day.sort((a, b) => b.c - a.c).slice(0, 10).forEach((x) => top.push(x.hit));
  }
  if (QUIET) return { brier: br / brN, picks: picks.filter(Boolean).length / picks.length, n: picks.length, top: top.filter(Boolean).length / top.length };
  const pc = (a) => `${a.filter(Boolean).length}/${a.length} (${Math.round((100 * a.filter(Boolean).length) / Math.max(1, a.length))}%)`;
  console.log(`Backtest ${dates[0]} to ${dates[dates.length - 1]} (${dates.length} days), settings ${JSON.stringify(CFG)}`);
  console.log('Our chance band -> how often it hit (and what we said on average):');
  ['90+', '80-90', '70-80', '60-70', '<60'].forEach((k) => { const b = bands[k]; if (b) console.log(`  ${k.padEnd(6)} ${b[1]}/${b[0]} = ${Math.round((100 * b[1]) / b[0])}%  (said ${Math.round((100 * b[2]) / b[0])}%)`); });
  console.log('Old way (season hit rate only), same bands:');
  ['90+', '80-90', '70-80', '60-70', '<60'].forEach((k) => { const b = baseBands[k]; if (b) console.log(`  ${k.padEnd(6)} ${b[1]}/${b[0]} = ${Math.round((100 * b[1]) / b[0])}%`); });
  console.log(`Plays (highest milestone at ${CFG.pick}%+, one per player and stat): ${pc(picks)}`);
  console.log(`Top 10 plays each day: ${pc(top)}`);
  console.log(`Brier score (lower is better): ${(br / brN).toFixed(4)}`);
  console.log('By stat: milestones rated, hit vs said, and everything we rated 75%+:');
  Object.entries(per).forEach(([st, x]) => console.log(`  ${st.padEnd(4)} ${String(x.n).padStart(5)} rated  hit ${Math.round((100 * x.hit) / x.n)}% said ${Math.round((100 * x.said) / x.n)}%  brier ${(x.br / x.n).toFixed(3)}  75%+: ${x.ph}/${x.p} = ${x.p ? Math.round((100 * x.ph) / x.p) : '-'}%`));
}

function live(day) {
  const players = loadPlayers(), games = read('games.json').filter((g) => g.date === day);
  if (!games.length) { console.error('No NBA games for ' + day); process.exit(1); }
  const tr = read('troster.json').filter((t) => t.sp === 'nba');
  const outIds = new Set(tr.flatMap((t) => (t.inj || []).filter((i) => /out/i.test(i[3])).map((i) => String(i[0]))));
  const before = '9999'; const opp3 = oppTable(players, before); const rows = [];
  for (const gm of games) {
    const [A, H] = gm.id.split('-');
    for (const [team, opp, ha] of [[A, H, 'A'], [H, A, 'H']]) {
      for (const p of players.filter((x) => x.team === team && !outIds.has(String(x.pid)))) {
        for (const st of OWN) { // public propfind.json keeps the 4 main stats (size); bookie lines use every stat
          const pr = project(p, st, opp, ha, before, opp3); if (!pr) continue; const bl = bestLine(pr); if (!bl) continue;
          rows.push({ game: gm.id, day, pid: p.pid, player: p.player, team, opp, ha, stat: st, line: bl.k, pick: `${p.player} ${bl.k}+ ${STATS[st].word}`, chance: bl.chance, fair: Math.round((100 / bl.chance) * 100) / 100, hit: bl.hit + '/' + bl.n, avg: Math.round(pr.seasonAvg * 10) / 10, l5: Math.round(pr.l5 * 10) / 10, proj: Math.round(pr.mu * 10) / 10, why: pr.notes });
        }
      }
    }
  }
  rows.sort((a, b) => b.chance - a.chance);
  // Bookmaker lines (props.json, private, from fetch-props.js): our chance for the exact line, both sides.
  const cutN = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/\s+/g, ' ').trim();
  const byName = new Map(players.map((p) => [cutN(p.player), p]));
  const book = [];
  for (const q of read('props.json').filter((x) => (x.sp || 'nba') === 'nba' && x.day === day && STATS[x.stat])) {
    const gm = games.find((g) => g.id === q.game); const p = byName.get(cutN(q.player)); if (!gm || !p || outIds.has(String(p.pid))) continue;
    const [A, H] = gm.id.split('-'); if (p.team !== A && p.team !== H) continue;
    const opp = p.team === A ? H : A, ha = p.team === H ? 'H' : 'A';
    const k = Math.floor(q.line) + 1; // over 24.5 means 25 or more
    const pr = project(p, q.stat, opp, ha, before, opp3, [k]); if (!pr) continue;
    const o = pr.out[0];
    for (const [side, price, bk] of [['over', q.over, q.over_book], ['under', q.under, q.under_book]]) {
      if (!price) continue;
      const chance = side === 'over' ? o.chance : Math.round((100 - o.chance) * 10) / 10;
      const hit = side === 'over' ? o.hit : o.n - o.hit;
      const implied = Math.round(1000 / price) / 10;
      const why = chance - 100 / price > 20 ? ['big gap to the bookie: check team news', ...pr.notes] : pr.notes;
      const pick = STATS[q.stat].bin ? `${p.player} ${side === 'over' ? '' : 'no '}${STATS[q.stat].word}` : `${p.player} ${side} ${q.line} ${STATS[q.stat].word}`;
      book.push({ sp: 'nba', main: q.main, kick: q.kick, pid: p.pid, game: q.game, day, player: p.player, team: p.team, opp, stat: q.stat, line: q.line, side, pick, chance, price, book: bk, implied, edge: Math.round((chance - implied) * 10) / 10, hit: hit + '/' + o.n, avg: Math.round(pr.seasonAvg * 10) / 10, l5: Math.round(pr.l5 * 10) / 10, proj: Math.round(pr.mu * 10) / 10, why });
    }
  }
  book.sort((a, b) => b.chance - a.chance);
  if (book.length) {
    const keepB = read('propbook.json').filter((r) => (r.sp || 'nba') !== 'nba' || r.day !== day);
    fs.writeFileSync(path.join(DATA, 'propbook.json'), JSON.stringify(keepB.concat(book)));
    const good = book.filter((r) => r.chance >= CFG.pick && r.price >= 1.3);
    console.log(`Bookmaker lines: ${book.length} sides rated; ${good.length} at ${CFG.pick}%+ paying $1.30+ (propbook.json, private):`);
    good.forEach((r) => console.log(`  ${r.chance}%  ${r.pick} @ $${r.price} ${r.book} (bookie implies ${r.implied}%, edge ${r.edge >= 0 ? '+' : ''}${r.edge}) avg ${r.avg}, last 5 ${r.l5}, hit ${r.hit}`));
  }
  const recent = [...new Set(read('games.json').map((g) => g.date))].slice(-3); // keep only the last few slates
  const keep = read('propfind.json').filter((r) => r.day !== day && recent.includes(r.day));
  fs.writeFileSync(path.join(DATA, 'propfind.json'), JSON.stringify(keep.concat(rows)));
  console.log(`${day}: ${rows.length} prop plays at ${CFG.pick}%+ across ${games.length} games. Top 10:`);
  rows.slice(0, 10).forEach((r) => console.log(`  ${r.chance}%  ${r.pick} (${r.game}) avg ${r.avg}, last 5 ${r.l5}, hit ${r.hit}${r.why.length ? '; ' + r.why.join('; ') : ''}`));
}

module.exports = { CFG, backtest };
if (require.main === module) {
  const a = process.argv[2];
  if (a === '--backtest') backtest(); else if (a) live(a); else { console.error('Usage: node scripts/prop-finder.js "<Sydney day>" | --backtest'); process.exit(1); }
}
