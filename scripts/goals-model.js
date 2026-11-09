// Football goals model: both teams to score and total goals, and the main goals play for each fixture.
// Usage: node scripts/goals-model.js            (updates public/data/fixtures.json)
//        node scripts/goals-model.js --backtest (scores the model on graded games in history.json; writes nothing)
// Run after fetch-football.js, fetch-ucl.js and fetch-ucl-match.js. Needs tprof, socp, uclx (optional).
//
// For each side it estimates the chance that side scores, from:
//   1. its scoring rate at this venue (home side at home, away side away) and the opponent's
//      conceding rate at the other venue (all games this season in its league and in Europe, ESPN);
//   2. expected goals from shots on target: its shots on target a game at this venue and the
//      opponent's shots on target allowed, times each side's conversion rate;
//   3. goals for and against a game at the venue;
//   4. key players out (FotMob): an attacker's share of the team's goals and assists comes off
//      that side's scoring, a regular defender or goalkeeper out adds to the opponent's;
//   5. past meetings (Champions League: from uclx; others: the last two league seasons), weighted
//      by how many there are.
// Both teams to score = chance home scores × chance away scores, blended with both sides'
// both-teams-scored rate at the venue. Totals use the same expected goals (Poisson) blended with
// each side's over rates at the venue. Every rate is shrunk toward the league average when the
// sample is small. Each fixture gets gm (the inputs, for the page), new p_btts / p_o15 / p_o25 /
// p_o35, btts_pick, ou_pick, and goals_play: the goals bet with the highest chance of landing,
// plus the best-value bet (62%+ and furthest above how often it normally happens).
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'public', 'data');
const CACHE = path.join(__dirname, '..', '.cache', 'soc-summary');
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/';
const SUM = 'https://site.web.api.espn.com/apis/site/v2/sports/soccer/all/summary?event=';
const SEASON = 2026;
const LG_SLUG = { 'Premier League': 'eng.1', 'La Liga': 'esp.1' };
const FM_LEAGUE = { 'Premier League': 47, 'La Liga': 87, 'Champions League': 42 };
const BACKTEST = process.argv.includes('--backtest');
fs.mkdirSync(CACHE, { recursive: true });

const read = (f, d = []) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch (e) { return d; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(url, tries = 4, headers = { 'User-Agent': 'StatSniper/1.0' }) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url, { headers }); if (r.status === 404) return null; if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } catch (e) { if (i === tries - 1) { console.warn('failed', url.slice(0, 120), e.message); return null; } await sleep(600 * 2 ** i); }
  }
}
const UA = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36' };
const fm = (u) => getJson('https://www.fotmob.com/api/data/' + u, 3, UA);
async function pool(items, n, fn) { const out = new Array(items.length); let next = 0; await Promise.all(Array.from({ length: n }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } })); return out; }
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\b(fc|cf|ac|as|sc|fk|sk|afc|club|de|cp|rc|vfb|vfl|rb|ssc)\b/g, ' ').replace(/\s+/g, ' ').trim();
const sim = (a, b) => { a = norm(a); b = norm(b); if (!a || !b) return 0; if (a === b || a.includes(b) || b.includes(a)) return 1; const A = new Set(a.split(' ')), B = b.split(' ').filter((w) => w.length > 2); return B.filter((w) => A.has(w)).length / Math.max(1, Math.min(A.size, B.length)); };
const r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100, pc = (x) => Math.round(x * 100);
const fact = (k) => { let f = 1; for (let i = 2; i <= k; i++) f *= i; return f; };
const pois = (l, k) => Math.exp(-l) * l ** k / fact(k);
const pOver = (l, line) => { let s = 0; for (let k = 0; k <= Math.floor(line); k++) s += pois(l, k); return 1 - s; };

// ---- team games with shots (cached summaries)
async function summary(id) {
  const f = path.join(CACHE, id + '.json');
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const s = await getJson(SUM + id); if (!s) return null;
  const teams = ((s.boxscore && s.boxscore.teams) || []).map((t) => ({ id: t.team.id, ha: t.homeAway, st: Object.fromEntries((t.statistics || []).map((x) => [x.name, Number(x.displayValue)])) }));
  const slim = { teams };
  fs.writeFileSync(f, JSON.stringify(slim)); return slim;
}
async function teamGames(team) {
  const lgs = [...new Set([team.lg, 'uefa.champions', 'uefa.europa', 'uefa.europa.conf'].filter(Boolean))];
  const evs = new Map();
  for (const lg of lgs) {
    const r = await getJson(`${SITE}${lg}/teams/${team.id}/schedule?season=${SEASON}`);
    for (const ev of (r && r.events) || []) {
      const c = ev.competitions && ev.competitions[0]; if (!c || !c.status || !c.status.type || !c.status.type.completed) continue;
      const me = c.competitors.find((x) => x.team && x.team.id === String(team.id)), op = c.competitors.find((x) => x !== me); if (!me || !op) continue;
      const sc = (x) => Number(x.score && typeof x.score === 'object' ? x.score.value : x.score);
      evs.set(ev.id, { id: ev.id, date: ev.date, home: me.homeAway === 'home', gf: sc(me), ga: sc(op), opp: op.team.id, comp: lg });
    }
  }
  const list = [...evs.values()].filter((g) => Number.isFinite(g.gf) && Number.isFinite(g.ga));
  await pool(list, 6, async (g) => { const s = await summary(g.id); const me = s && s.teams.find((t) => t.id === String(team.id)), op = s && s.teams.find((t) => t.id !== String(team.id)); if (me && op) { g.sh = me.st.totalShots; g.sot = me.st.shotsOnTarget; g.osh = op.st.totalShots; g.osot = op.st.shotsOnTarget; } });
  return list.sort((a, b) => (a.date < b.date ? -1 : 1));
}

// ---- the model
function priors(all) {
  const gs = all.filter((g) => Number.isFinite(g.sot));
  const sum = (f) => gs.reduce((s, g) => s + f(g), 0), n = gs.length || 1;
  const home = gs.filter((g) => g.home), away = gs.filter((g) => !g.home);
  return {
    score: all.filter((g) => g.gf > 0).length / (all.length || 1),
    btts: all.filter((g) => g.gf > 0 && g.ga > 0).length / (all.length || 1),
    o15: all.filter((g) => g.gf + g.ga > 1).length / (all.length || 1), o25: all.filter((g) => g.gf + g.ga > 2).length / (all.length || 1), o35: all.filter((g) => g.gf + g.ga > 3).length / (all.length || 1),
    rho: (all.filter((g) => g.gf > 0 && g.ga > 0).length / (all.length || 1)) / ((all.filter((g) => g.gf > 0).length / (all.length || 1)) ** 2 || 1),
    conv: sum((g) => g.gf) / (sum((g) => g.sot) || 1), sot: sum((g) => g.sot) / n, gpg: all.reduce((s, g) => s + g.gf, 0) / (all.length || 1),
    sotH: home.reduce((s, g) => s + g.sot, 0) / (home.length || 1), sotA: away.reduce((s, g) => s + g.sot, 0) / (away.length || 1),
  };
}
const shrink = (k, n, prior, w) => (k + prior * w) / (n + w);
function side(games, venueHome, P) {
  const all = games, v = games.filter((g) => g.home === venueHome), sh = all.filter((g) => Number.isFinite(g.sot)), shv = v.filter((g) => Number.isFinite(g.sot));
  const cnt = (list, f) => list.filter(f).length, avg = (list, f, prior, w) => shrink(list.reduce((s, g) => s + f(g), 0), list.length, prior, w);
  const scoreAll = shrink(cnt(all, (g) => g.gf > 0), all.length, P.score, 4), concAll = shrink(cnt(all, (g) => g.ga > 0), all.length, P.score, 4);
  const bttsAll = shrink(cnt(all, (g) => g.gf > 0 && g.ga > 0), all.length, P.btts, 4);
  const sotPrior = venueHome ? P.sotH : P.sotA, osotPrior = venueHome ? P.sotA : P.sotH;
  const sotAll = avg(sh, (g) => g.sot, sotPrior, 3), osotAll = avg(sh, (g) => g.osot, osotPrior, 3);
  const last = all.slice(-6), rec = (f, base) => 0.65 * base + 0.35 * shrink(cnt(last, f), last.length, base, 2);
  return {
    n: all.length, nv: v.length,
    score: rec((g) => g.gf > 0, shrink(cnt(v, (g) => g.gf > 0), v.length, scoreAll, 3)), conc: rec((g) => g.ga > 0, shrink(cnt(v, (g) => g.ga > 0), v.length, concAll, 3)),
    btts: rec((g) => g.gf > 0 && g.ga > 0, shrink(cnt(v, (g) => g.gf > 0 && g.ga > 0), v.length, bttsAll, 3)),
    o15: shrink(cnt(v, (g) => g.gf + g.ga > 1), v.length, shrink(cnt(all, (g) => g.gf + g.ga > 1), all.length, P.o15, 4), 3),
    o25: shrink(cnt(v, (g) => g.gf + g.ga > 2), v.length, shrink(cnt(all, (g) => g.gf + g.ga > 2), all.length, P.o25, 4), 3),
    o35: shrink(cnt(v, (g) => g.gf + g.ga > 3), v.length, shrink(cnt(all, (g) => g.gf + g.ga > 3), all.length, P.o35, 4), 3),
    gf: avg(v, (g) => g.gf, avg(all, (g) => g.gf, P.gpg, 3), 3), ga: avg(v, (g) => g.ga, avg(all, (g) => g.ga, P.gpg, 3), 3),
    sh: avg(shv, (g) => g.sh, avg(sh, (g) => g.sh, P.sot * 3, 3), 3), osh: avg(shv, (g) => g.osh, avg(sh, (g) => g.osh, P.sot * 3, 3), 3),
    sot: avg(shv, (g) => g.sot, sotAll, 3), osot: avg(shv, (g) => g.osot, osotAll, 3),
    conv: shrink(sh.reduce((s, g) => s + g.gf, 0), sh.reduce((s, g) => s + g.sot, 0), P.conv, 12),
    oconv: shrink(sh.reduce((s, g) => s + g.ga, 0), sh.reduce((s, g) => s + g.osot, 0), P.conv, 12),
  };
}
// Chance each side scores, expected goals, BTTS and totals.
function model(Hg, Ag, P, adj = {}) {
  const H = side(Hg, true, P), A = side(Ag, false, P);
  const lamH0 = 0.5 * ((H.gf + A.ga) / 2) + 0.5 * ((H.sot * H.conv + A.osot * A.oconv) / 2);
  const lamA0 = 0.5 * ((A.gf + H.ga) / 2) + 0.5 * ((A.sot * A.conv + H.osot * H.oconv) / 2);
  const mH = (1 - (adj.attH || 0)) * (1 + (adj.defA || 0)), mA = (1 - (adj.attA || 0)) * (1 + (adj.defH || 0));
  const lamH = lamH0 * mH, lamA = lamA0 * mA;
  const empH = (H.score + A.conc) / 2, empA = (A.score + H.conc) / 2;
  const adjP = (p, m) => 1 - (1 - p) ** m; // more or less likely to score as expected goals move
  const pH = adjP(0.5 * (1 - Math.exp(-lamH0)) + 0.5 * empH, mH), pA = adjP(0.5 * (1 - Math.exp(-lamA0)) + 0.5 * empA, mA);
  let btts = 0.65 * Math.min(1, P.rho) * pH * pA + 0.35 * ((H.btts + A.btts) / 2); // scoring is not independent: correct with the pool's own ratio
  const lam = lamH + lamA;
  let o15 = 0.6 * pOver(lam, 1.5) + 0.4 * ((H.o15 + A.o15) / 2), o25 = 0.6 * pOver(lam, 2.5) + 0.4 * ((H.o25 + A.o25) / 2), o35 = 0.6 * pOver(lam, 3.5) + 0.4 * ((H.o35 + A.o35) / 2);
  const m = adj.h2h || [];
  let hw = 0;
  if (m.length) {
    hw = Math.min(0.25, 0.05 * m.length);
    const rate = (f) => m.filter(f).length / m.length;
    btts = (1 - hw) * btts + hw * rate((g) => g[0] > 0 && g[1] > 0);
    o15 = (1 - hw) * o15 + hw * rate((g) => g[0] + g[1] > 1); o25 = (1 - hw) * o25 + hw * rate((g) => g[0] + g[1] > 2); o35 = (1 - hw) * o35 + hw * rate((g) => g[0] + g[1] > 3);
  }
  return { H, A, lamH, lamA, pH, pA, btts, o15, o25, o35, hw };
}

// ---- key players out (FotMob) → attack and defence adjustments
async function absences(f, kickIso, socp, teamCode) {
  const d = kickIso.slice(0, 10).replace(/-/g, '');
  const day = await fm('matches?date=' + d);
  const lid = FM_LEAGUE[f.league];
  const ms = ((day && day.leagues) || []).filter((l) => l.primaryId === lid || l.id === lid).flatMap((l) => l.matches || []);
  const m = ms.map((x) => [x, sim(x.home.name, f.home) + sim(x.away.name, f.away)]).sort((a, b) => b[1] - a[1])[0];
  if (!m || m[1] < 1) return null;
  const md = await fm('matchDetails?matchId=' + m[0].id);
  const lu = md && md.content && md.content.lineup; if (!lu) return null;
  const out = {};
  for (const [side, name] of [['homeTeam', f.home], ['awayTeam', f.away]]) {
    const code = teamCode(name); const mine = socp.filter((p) => p.team === code);
    const tg = mine.reduce((s, p) => s + p.g, 0) || 1, games = Math.max(...mine.map((p) => p.n), 1);
    let att = 0, def = 0; const who = [];
    for (const u of (lu[side] && lu[side].unavailable) || []) {
      const un = u.unavailability || {}; const w = /doubt/i.test(un.expectedReturn || '') ? 0.5 : 1;
      const p = mine.find((q) => sim(q.player, u.name) >= 1 || norm(q.player).split(' ').pop() === norm(u.name).split(' ').pop());
      if (!p) { who.push([u.name, '', un.type || 'out', 0]); continue; }
      const share = (p.g + 0.5 * p.a) / tg; const regular = p.n >= games * 0.5;
      if (share > 0) att += w * share * 0.6; // replacements score some of those goals
      if (regular && (p.pos === 'D' || p.pos === 'G')) def += w * (p.pos === 'G' ? 0.06 : 0.04);
      who.push([u.name, p.pos, un.type || 'out', Math.round(share * 100)]);
    }
    out[side === 'homeTeam' ? 'H' : 'A'] = { att: Math.min(0.35, att), def: Math.min(0.2, def), who };
  }
  return out;
}

// socp rows → this season's goals / assists / apps per player
function socpSeason(rows) {
  return rows.map((r) => { const cols = String(r.cols || '').split(','), gi = cols.indexOf('totalGoals'), ai = cols.indexOf('goalAssists'); let n = 0, g = 0, a = 0; String(r.g || '').split(';').forEach((s) => { const v = s.split(','); if (v[1] !== '2026-27') return; n++; g += Number(v[7 + gi]) || 0; a += Number(v[7 + ai]) || 0; }); return { player: r.player, team: r.team, pos: r.pos === 'GK' ? 'G' : r.pos, n, g, a }; });
}

// ---- main play: furthest above the base rate (62%+), plus the safest line (75%+)
// Main pick: the goals bet with the highest chance of landing by our research, among bets that pay
// at least MIN_PRICE. With Australian bookmaker prices on file (odds.json from fetch-odds.js) that is
// the best real price; without one, the price is estimated as a bookmaker would roughly set it:
// halfway between our chance and how often the bet normally lands, less a 5% margin
// (price = 0.95 / ((our chance + usual rate) / 2)).
// Best value: the bet furthest above how often it normally happens (62%+ and 5+ points above), when it differs.
const MIN_PRICE = 1.4;
function goalsPlay(p, P, prices = {}) {
  const C = [['Over 1.5', p.o15, P.o15], ['Under 1.5', 1 - p.o15, 1 - P.o15], ['Over 2.5', p.o25, P.o25], ['Under 2.5', 1 - p.o25, 1 - P.o25], ['Over 3.5', p.o35, P.o35], ['Under 3.5', 1 - p.o35, 1 - P.o35], ['Both score', p.btts, P.btts], ['Not both', 1 - p.btts, 1 - P.btts]];
  const priced = C.map(([k, ch, base]) => { const real = prices[k]; return { k, ch, base, price: real ? real.price : Math.round((0.95 / ((ch + base) / 2)) * 100) / 100, book: real ? real.book : null, est: !real }; });
  const ok = priced.filter((c) => c.price >= MIN_PRICE).sort((a, b) => b.ch - a.ch);
  const main = ok[0] || priced.slice().sort((a, b) => b.price - a.price)[0];
  const val = C.filter((c) => c[1] >= 0.62 && c[1] - c[2] >= 0.05).sort((a, b) => (b[1] - b[2]) - (a[1] - a[2]))[0];
  const conf = (x) => (x >= 0.7 ? 'High' : x >= 0.62 ? 'Medium' : 'Low');
  const top = priced.slice().sort((a, b) => b.ch - a.ch)[0];
  return { pick: main.k, pct: pc(main.ch), base: pc(main.base), conf: conf(main.ch), price: main.price, book: main.book, est: main.est,
    safest: top.k !== main.k ? { pick: top.k, pct: pc(top.ch), price: top.price, est: top.est } : null,
    value: val && val[0] !== main.k ? { pick: val[0], pct: pc(val[1]), base: pc(val[2]) } : null };
}
function why(f, p, inj, h2h) {
  const H = p.H, A = p.A, out = [];
  out.push(`${f.home} score in ${pc(H.score)}% of home games and ${f.away} concede in ${pc(A.conc)}% away: ${pc(p.pH)}% chance ${f.home} score.`);
  out.push(`${f.away} score in ${pc(A.score)}% of away games and ${f.home} concede in ${pc(H.conc)}% at home: ${pc(p.pA)}% chance ${f.away} score.`);
  out.push(`Shots on target a game: ${f.home} ${r1(H.sot)} at home (allow ${r1(H.osot)}), ${f.away} ${r1(A.sot)} away (allow ${r1(A.osot)}). Expected goals ${r2(p.lamH)} to ${r2(p.lamA)}.`);
  if (inj) for (const [k, nm] of [['H', f.home], ['A', f.away]]) { const x = inj[k]; if (!x || !x.who.length) continue; const key = x.who.filter((w) => w[3] >= 10 || w[1] === 'D' || w[1] === 'G').map((w) => w[0] + (w[3] ? ' (' + w[3] + '% of goals+assists)' : w[1] ? ' (' + w[1] + ')' : '')); if (key.length) out.push(`${nm} missing ${key.join(', ')}${x.att ? `: attack ${-Math.round(x.att * 100)}%` : ''}${x.def ? `, opponents +${Math.round(x.def * 100)}%` : ''}.`); }
  if (h2h && h2h.length) out.push(`Past meetings (${h2h.length}): both scored in ${h2h.filter((g) => g[0] > 0 && g[1] > 0).length}, over 2.5 in ${h2h.filter((g) => g[0] + g[1] > 2).length} (weight ${Math.round(p.hw * 100)}%).`);
  return out;
}

(async () => {
  const tprof = read('tprof.json').filter((t) => t.sp === 'fb'), ucl = read('ucl_teams.json');
  const lgOf = (t) => (LG_SLUG[t.league] || (ucl.find((u) => String(u.id) === String(t.id)) || {}).lg || null);
  const teamBy = (name) => { const t = tprof.map((x) => [x, Math.max(sim(x.name, name), sim(x.short || '', name))]).sort((a, b) => b[1] - a[1])[0]; return t && t[1] >= 1 ? { id: t[0].id, code: t[0].code, name: t[0].name, lg: lgOf(t[0]) } : null; };
  const fixtures = read('fixtures.json'), hist = read('history.json'), uclx = read('uclx.json');
  const todo = BACKTEST
    ? hist.filter((h) => h.sport === 'fb' && h.status === 'Final').map((h) => ({ f: { id: h.id, league: h.league, home: h.home_name, away: h.away_name, old: h.p_btts, oldO25: h.p_o25 }, h }))
    : fixtures.map((f) => ({ f }));
  const teams = new Map();
  for (const { f } of todo) for (const n of [f.home, f.away]) { const t = teamBy(n); if (t) teams.set(t.id, t); }
  console.log(`${todo.length} matches, ${teams.size} clubs: loading their games and shots…`);
  const games = new Map(); let k = 0;
  await pool([...teams.values()], 4, async (t) => { games.set(t.id, await teamGames(t)); if (++k % 10 === 0) console.log(`  ${k}/${teams.size}`); });
  const allGames = [...games.values()].flat();

  if (BACKTEST) {
    const gpStats = {}; let vN = 0, vH = 0, n = 0, bNew = 0, bOld = 0, both = 0, sNew = 0, sOld = 0, o25 = 0, pNew25 = 0, pOld25 = 0, bs25n = 0, bs25o = 0, hits = 0, plays = 0; const rows = [];
    for (const { f, h } of todo) {
      const H = teamBy(f.home), A = teamBy(f.away); if (!H || !A) continue;
      const kick = (games.get(H.id) || []).find((g) => g.home && g.opp === A.id && g.date >= '2026-10-25');
      if (!kick) continue;
      const before = (list) => list.filter((g) => g.date < kick.date);
      const P = priors(allGames.filter((g) => g.date < kick.date));
      const m = model(before(games.get(H.id)), before(games.get(A.id)), P);
      const y = h.home_pts > 0 && h.away_pts > 0 ? 1 : 0, y25 = h.home_pts + h.away_pts > 2 ? 1 : 0;
      n++; both += y; sNew += m.btts; sOld += (f.old || 0) / 100; o25 += y25; pNew25 += m.o25; pOld25 += (f.oldO25 || 0) / 100;
      bNew += (m.btts - y) ** 2; bOld += ((f.old || 0) / 100 - y) ** 2; bs25n += (m.o25 - y25) ** 2; bs25o += ((f.oldO25 || 0) / 100 - y25) ** 2;
      const gp = goalsPlay(m, P); if (gp.pct) { plays++; const tot = h.home_pts + h.away_pts; const ok = { 'Over 1.5': tot > 1, 'Under 1.5': tot < 2, 'Over 2.5': tot > 2, 'Under 2.5': tot < 3, 'Over 3.5': tot > 3, 'Under 3.5': tot < 4, 'Both score': y === 1, 'Not both': y === 0 }[gp.pick]; hits += ok ? 1 : 0; (gpStats[gp.pick] = gpStats[gp.pick] || [0, 0])[0]++; if (ok) gpStats[gp.pick][1]++; if (gp.value) { const okv = { 'Over 1.5': tot > 1, 'Under 1.5': tot < 2, 'Over 2.5': tot > 2, 'Under 2.5': tot < 3, 'Over 3.5': tot > 3, 'Under 3.5': tot < 4, 'Both score': y === 1, 'Not both': y === 0 }[gp.value.pick]; vN++; if (okv) vH++; } rows.push(`${f.id} ${h.home_pts}-${h.away_pts}: ${gp.pick} ${gp.pct}% ${ok ? 'hit' : 'miss'} (btts new ${pc(m.btts)} old ${f.old})`); }
    }
    console.log(rows.join('\n'));
    console.log(`\nBacktest on ${n} graded games (only games before each match used):`);
    console.log(`  Both teams scored in ${both} (${Math.round((100 * both) / n)}%). Average chance: new ${Math.round((100 * sNew) / n)}%, old ${Math.round((100 * sOld) / n)}%. Brier (lower is better): new ${(bNew / n).toFixed(3)}, old ${(bOld / n).toFixed(3)}.`);
    console.log(`  Over 2.5 in ${o25} (${Math.round((100 * o25) / n)}%). Average chance: new ${Math.round((100 * pNew25) / n)}%, old ${Math.round((100 * pOld25) / n)}%. Brier: new ${(bs25n / n).toFixed(3)}, old ${(bs25o / n).toFixed(3)}.`);
    console.log(`  Main goals play: ${hits}/${plays} right (${n - plays} games had no strong play). By pick: ${Object.entries(gpStats).map(([k, v]) => k + ' ' + v[1] + '/' + v[0]).join(', ')}. Best-value picks: ${vH}/${vN}.`);
    const PA = priors(allGames); console.log('  Season pool (' + allGames.length + ' team-games): scored ' + pc(PA.score) + '%, both scored ' + pc(PA.btts) + '%, score^2 ' + pc(PA.score ** 2) + '%, over 2.5 ' + pc(PA.o25) + '%, over 1.5 ' + pc(PA.o15) + '%, conv ' + pc(PA.conv) + '%');
    const late = allGames.filter((g) => g.date >= '2026-10-25'); const PL2 = priors(late); console.log('  Since 25 Oct (' + late.length + '): both scored ' + pc(PL2.btts) + '%, over 2.5 ' + pc(PL2.o25) + '%');
    return;
  }

  const socp = socpSeason(read('socp.json'));
  const codeOf = (name) => (teamBy(name) || {}).code;
  const P = priors(allGames);
  const odds = read('odds.json');
  let done = 0;
  for (const f of fixtures) {
    const H = teamBy(f.home), A = teamBy(f.away); if (!H || !A) { console.warn('no club for', f.id); continue; }
    const X = uclx.find((r) => r.id === f.id);
    let h2h = X ? (X.h2h || []).map((g) => (g[2] === H.code ? [g[4], g[5]] : [g[5], g[4]])) : [];
    if (!X && H.lg && H.lg === A.lg) { // same league: last two league seasons
      for (const s of [SEASON - 1, SEASON - 2]) { const r = await getJson(`${SITE}${H.lg}/teams/${H.id}/schedule?season=${s}`); for (const ev of (r && r.events) || []) { const c = ev.competitions[0]; if (!c.status.type.completed) continue; const me = c.competitors.find((x) => x.team.id === String(H.id)), op = c.competitors.find((x) => x !== me); if (!op || op.team.id !== String(A.id)) continue; const sc = (x) => Number(x.score && typeof x.score === 'object' ? x.score.value : x.score); h2h.push(me.homeAway === 'home' ? [sc(me), sc(op)] : [sc(op), sc(me)]); } }
    }
    let inj = null;
    try { const t = f.time.match(/\w{3} (\d+) (\w{3}), (\d+:\d+ [AP]M)/); const d = t ? new Date(Date.parse(`${t[1]} ${t[2]} 2026 ${t[3]} GMT+1100`)) : null; if (d && !isNaN(d)) inj = await absences(f, d.toISOString(), socp, codeOf); } catch (e) { inj = null; }
    const m = model(games.get(H.id) || [], games.get(A.id) || [], P, { attH: inj && inj.H ? inj.H.att : 0, defH: inj && inj.H ? inj.H.def : 0, attA: inj && inj.A ? inj.A.att : 0, defA: inj && inj.A ? inj.A.def : 0, h2h });
    const prices = Object.fromEntries(odds.filter((o) => o.game === f.id && /Total goals|Both teams/.test(o.market)).map((o) => [o.pick, { price: o.price, book: o.book }]));
    const gp = goalsPlay(m, P, prices);
    Object.assign(f, {
      p_btts: pc(m.btts), p_o15: pc(m.o15), p_o25: pc(m.o25), p_o35: pc(m.o35),
      btts_pick: m.btts >= 0.6 ? 'Both score' : m.btts <= 0.4 ? 'Not both' : 'Coin toss', btts_conf: Math.abs(m.btts - 0.5) >= 0.15 ? 'High' : Math.abs(m.btts - 0.5) >= 0.07 ? 'Medium' : 'Low',
      ou_pick: m.o25 >= 0.58 ? 'Over 2.5' : m.o25 <= 0.42 ? 'Under 2.5' : 'Coin toss', ou_conf: Math.abs(m.o25 - 0.5) >= 0.15 ? 'High' : Math.abs(m.o25 - 0.5) >= 0.07 ? 'Medium' : 'Low',
      xg_home: r2(m.lamH), xg_away: r2(m.lamA), xg_total: r2(m.lamH + m.lamA),
      goals_play: gp,
      gm: { pH: pc(m.pH), pA: pc(m.pA), h: { n: m.H.n, nv: m.H.nv, score: pc(m.H.score), conc: pc(m.H.conc), btts: pc(m.H.btts), sh: r1(m.H.sh), sot: r1(m.H.sot), osh: r1(m.H.osh), osot: r1(m.H.osot), conv: pc(m.H.conv) }, a: { n: m.A.n, nv: m.A.nv, score: pc(m.A.score), conc: pc(m.A.conc), btts: pc(m.A.btts), sh: r1(m.A.sh), sot: r1(m.A.sot), osh: r1(m.A.osh), osot: r1(m.A.osot), conv: pc(m.A.conv) }, injH: inj && inj.H ? { att: pc(inj.H.att), def: pc(inj.H.def) } : null, injA: inj && inj.A ? { att: pc(inj.A.att), def: pc(inj.A.def) } : null, h2h: h2h.length, why: why(f, m, inj, h2h), base: { btts: pc(P.btts), o25: pc(P.o25) } },
    });
    done++;
  }
  fs.writeFileSync(path.join(DATA, 'fixtures.json'), JSON.stringify(fixtures));
  console.log(`goals model: ${done} fixtures updated. League rates: both scored ${pc(P.btts)}%, over 2.5 ${pc(P.o25)}%, over 1.5 ${pc(P.o15)}%; ${pc(P.conv)}% of shots on target scored.`);
})().catch((e) => { console.error(e); process.exit(1); });
