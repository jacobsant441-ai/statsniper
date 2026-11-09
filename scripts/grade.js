// Grades StatSniper's picks against final results from ESPN, for every sport, and keeps
// the `history` dataset (one row per pick per day) that the Review page shows with ticks
// and crosses. Safe to run as often as you like: rows are added or updated, never removed,
// and verdicts or factors written by a person or a summary run are kept.
// Usage: npm run grade
//
// Reads  public/data: games, pred, final (NBA), fixtures (football), nflgames (NFL),
//                     ufcfights and ufcp (UFC), table, ucl_teams, history.
// Writes public/data: history.json, final.json (NBA scores), ufcfights.json (status,
//                     result, method), nflresults.json (the latest NFL week's finals).
//
// What is graded:
//   NBA   winner pick; total lean (Lean over / Lean under against the posted total)
//   NFL   winner pick; total lean; spread pick (cover_pick against the home spread)
//   Football  result pick (home, draw or away); both teams to score; over/under 2.5
//   UFC   winner pick (method and round recorded)
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'public', 'data');
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/';
const NBA_CODE = { GS: 'GSW', NO: 'NOP', NY: 'NYK', SA: 'SAS', UTAH: 'UTA', WSH: 'WAS' };
const NFL_CODE = { JAX: 'JAC', LAR: 'LA', WSH: 'WAS' };
const SOC_CODE = { BHA: 'BRI', CHE: 'CFC', LIV: 'LFC', MNC: 'MCI', MAN: 'MUN', CEL: 'RCC', RAY: 'RVC', BET: 'RBB', VAL: 'VCF' };
const FB_SLUG = { 'Premier League': 'eng.1', 'La Liga': 'esp.1', 'Champions League': 'uefa.champions' };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const read = (f, d = []) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch (e) { return d; } };
const write = (f, d) => fs.writeFileSync(path.join(DATA, f), JSON.stringify(d));
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\(c\)/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\b(fc|cf|afc|sc|club|de|the)\b/g, ' ').replace(/\s+/g, ' ').trim();
const normDay = (s) => String(s || '').replace(/^(\w+) 0(\d) /, '$1 $2 ').trim();
const sydKey = (iso) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', weekday: 'short', day: 'numeric', month: 'short' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value])); return `${p.weekday} ${p.day} ${p.month}`; };

const cache = new Map();
async function getJson(url) {
  if (cache.has(url)) return cache.get(url);
  const p = (async () => {
    for (let i = 0; i < 3; i++) {
      try { const r = await fetch(url, { headers: { 'User-Agent': 'StatSniper/1.0' } }); if (r.status === 404) return null; if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } catch (e) { if (i === 2) { console.warn('fetch failed', url, e.message); return null; } await new Promise((r) => setTimeout(r, 800 * (i + 1))); }
    }
  })();
  cache.set(url, p); return p;
}
// A Sydney day key like "Sun 1 Nov" covers US/UTC dates of that day and the day before.
const yearOf = (mon) => { const now = new Date(); const y = now.getFullYear(); const m = MON.indexOf(mon); return m > now.getMonth() + 2 ? y - 1 : y; };
function espnDates(day) {
  const [, d, mon] = normDay(day).split(' '); const y = yearOf(mon);
  const base = new Date(Date.UTC(y, MON.indexOf(mon), Number(d), 12));
  return [-1, 0].map((k) => { const x = new Date(base.getTime() + k * 86400000); return `${x.getUTCFullYear()}${String(x.getUTCMonth() + 1).padStart(2, '0')}${String(x.getUTCDate()).padStart(2, '0')}`; });
}
async function events(slug, day) {
  const out = [];
  for (const d of espnDates(day)) { const r = await getJson(`${SITE}${slug}/scoreboard?dates=${d}`); out.push(...((r && r.events) || [])); }
  return out;
}
const stateOf = (c) => (c.status && c.status.type && (c.status.type.completed ? 'Final' : c.status.type.state === 'in' ? 'Live' : 'Pending')) || 'Pending';
const score = (x) => Number(x && typeof x.score === 'object' ? x.score.value : x && x.score);
const tick = (h) => (h === 'hit' ? '✓' : h === 'miss' ? '✗' : '');

function mergeRow(hist, row) {
  const i = hist.findIndex((h) => h.sport === row.sport && normDay(h.date) === normDay(row.date) && h.id === row.id);
  if (i < 0) { hist.push(row); return 'added'; }
  const old = hist[i];
  const keep = {};
  // Keep a person's or a summary run's words; refresh the automatic ones.
  if (old.verdict && !old.auto) keep.verdict = old.verdict;
  if (Array.isArray(old.factors) && old.factors.length && !old.auto) keep.factors = old.factors;
  hist[i] = { ...old, ...row, ...keep, auto: keep.verdict ? false : row.auto };
  return 'updated';
}
const totalHit = (lean, total, line) => {
  if (!Number.isFinite(total) || !Number.isFinite(Number(line)) || !/over|under/i.test(lean || '')) return '';
  if (total === Number(line)) return 'push';
  return (/over/i.test(lean) ? total > line : total < line) ? 'hit' : 'miss';
};

async function gradeNba(hist, final) {
  const games = read('games.json'), pred = read('pred.json');
  let n = 0;
  for (const g of games) {
    const p = pred.find((x) => x.id === g.id); if (!p) continue;
    const day = normDay(g.date || 'Thu 29 Oct');
    const ev = (await events('basketball/nba', day)).find((e) => { const c = e.competitions[0]; const a = c.competitors.find((x) => x.homeAway === 'away'), h = c.competitors.find((x) => x.homeAway === 'home'); return `${NBA_CODE[a.team.abbreviation] || a.team.abbreviation}-${NBA_CODE[h.team.abbreviation] || h.team.abbreviation}` === g.id && sydKey(e.date) === day; });
    if (!ev) continue;
    const c = ev.competitions[0], a = c.competitors.find((x) => x.homeAway === 'away'), h = c.competitors.find((x) => x.homeAway === 'home');
    const status = stateOf(c), ap = score(a), hp = score(h);
    const [an, hn] = String(p.matchup || g.matchup || '').split(' @ ');
    const row = { sport: 'nba', date: day, id: g.id, away: g.away, home: g.home, away_name: an || g.away, home_name: hn || g.home, kick: String(g.time || '').toLowerCase(), status, away_pts: status === 'Pending' ? null : ap, home_pts: status === 'Pending' ? null : hp, pick: p.ml_pick || p.winner, pick_pct: p.ml_final_prob, conf: p.combined_conf || p.confidence, total_lean: p.total_lean, posted_total: p.posted_total ?? g.total, proj_total: p.proj_total, winner_hit: '', total_hit: '', auto: true };
    if (status === 'Final') {
      const win = ap > hp ? g.away : g.home;
      row.winner_hit = win === row.pick ? 'hit' : 'miss';
      row.total_hit = totalHit(row.total_lean, ap + hp, row.posted_total);
      row.verdict = `${tick(row.winner_hit)} Picked ${row.pick} (${row.pick_pct}%, ${row.conf}): ${win} won ${Math.max(ap, hp)}-${Math.min(ap, hp)}.` + (row.total_hit ? ` ${tick(row.total_hit)} ${row.total_lean} ${row.posted_total}: total was ${ap + hp}.` : ` Total ${ap + hp} against ${row.posted_total}.`);
      row.factors = p.margin != null ? [`Margin: we projected ${p.winner} by ${p.margin}; actual ${win} by ${Math.abs(ap - hp)}.`] : [];
    }
    mergeRow(hist, row); n++;
    const fi = final.findIndex((f) => f.id === g.id && (!f.date || normDay(f.date) === day));
    const fr = { id: g.id, status: status === 'Pending' ? 'Scheduled' : status, away_pts: row.away_pts, home_pts: row.home_pts, note: status === 'Live' ? 'In progress at the last update' : '', date: day };
    if (status !== 'Pending') { if (fi >= 0) final[fi] = { ...final[fi], ...fr }; else final.push(fr); }
  }
  return n;
}

async function gradeNfl(hist) {
  const games = read('nflgames.json');
  let n = 0;
  for (const g of games) {
    const day = normDay(String(g.kick).split(',')[0]);
    const ev = (await events('football/nfl', day)).find((e) => { const c = e.competitions[0]; const a = c.competitors.find((x) => x.homeAway === 'away'), h = c.competitors.find((x) => x.homeAway === 'home'); return `${NFL_CODE[a.team.abbreviation] || a.team.abbreviation}-${NFL_CODE[h.team.abbreviation] || h.team.abbreviation}` === g.id; });
    if (!ev) continue;
    const c = ev.competitions[0], a = c.competitors.find((x) => x.homeAway === 'away'), h = c.competitors.find((x) => x.homeAway === 'home');
    const status = stateOf(c), ap = score(a), hp = score(h);
    const row = { sport: 'nfl', date: day, id: g.id, away: g.away, home: g.home, away_name: g.away_name, home_name: g.home_name, kick: String(g.kick).split(',').slice(1).join(',').trim(), status, away_pts: status === 'Pending' ? null : ap, home_pts: status === 'Pending' ? null : hp, pick: g.pick, pick_pct: g.pick_pct, conf: g.conf, total_lean: g.total_lean, posted_total: g.total, proj_total: g.proj_total, spread_pick: g.cover_pick || g.ats_pick || '', spread_home: g.spread_home, winner_hit: '', total_hit: '', spread_hit: '', auto: true };
    if (status === 'Final') {
      const win = ap > hp ? g.away : hp > ap ? g.home : 'TIE';
      row.winner_hit = win === g.pick ? 'hit' : 'miss';
      row.total_hit = totalHit(g.total_lean, ap + hp, g.total);
      if (row.spread_pick && Number.isFinite(Number(g.spread_home))) { const homeAts = hp + Number(g.spread_home) - ap; row.spread_hit = homeAts === 0 ? 'push' : (homeAts > 0 ? g.home : g.away) === row.spread_pick ? 'hit' : 'miss'; }
      row.verdict = `${tick(row.winner_hit)} Picked ${g.pick} (${g.pick_pct}%, ${g.conf}): ${win === 'TIE' ? 'tie' : win + ' won'} ${Math.max(ap, hp)}-${Math.min(ap, hp)}.` + (row.total_hit ? ` ${tick(row.total_hit)} ${g.total_lean} ${g.total}: total ${ap + hp}.` : '') + (row.spread_hit ? ` ${tick(row.spread_hit)} Spread pick ${row.spread_pick}.` : '');
      row.factors = g.proj_home != null ? [`Score: we projected ${g.home} ${g.proj_home} - ${g.away} ${g.proj_away}; final ${g.home} ${hp} - ${g.away} ${ap}.`] : [];
    }
    mergeRow(hist, row); n++;
  }
  return n;
}

async function gradeFootball(hist) {
  const fixtures = read('fixtures.json'), table = read('table.json'), ucl = read('ucl_teams.json');
  const codeOf = (name, league) => { const t = table.find((q) => q.team === name && q.league === league) || table.find((q) => q.team === name); return t ? t.abbr : String(name).slice(0, 3).toUpperCase(); };
  const espnCode = (t) => { const u = ucl.find((x) => x.id === t.id); return u ? u.code : SOC_CODE[t.abbreviation] || t.abbreviation; };
  let n = 0;
  for (const x of fixtures) {
    const slug = FB_SLUG[x.league]; if (!slug) continue;
    const day = normDay(String(x.time).split(',')[0]);
    const hc = codeOf(x.home, x.league), ac = codeOf(x.away, x.league);
    const ev = (await events('soccer/' + slug, day)).find((e) => { const c = e.competitions[0]; const h = c.competitors.find((q) => q.homeAway === 'home'), a = c.competitors.find((q) => q.homeAway === 'away'); return (espnCode(h.team) === hc && espnCode(a.team) === ac) || (norm(h.team.displayName) === norm(x.home) && norm(a.team.displayName) === norm(x.away)); });
    if (!ev) continue;
    const c = ev.competitions[0], h = c.competitors.find((q) => q.homeAway === 'home'), a = c.competitors.find((q) => q.homeAway === 'away');
    const status = stateOf(c), hg = score(h), ag = score(a);
    const pickSide = /draw/i.test(x.pick) ? 'Draw' : x.pick.indexOf(x.home) === 0 ? hc : ac;
    const row = { sport: 'fb', league: x.league, date: day, id: x.id, away: ac, home: hc, away_name: x.away, home_name: x.home, kick: String(x.time).split(',').slice(1).join(',').replace(/\s*AEDT/, '').trim().toLowerCase(), status, away_pts: status === 'Pending' ? null : ag, home_pts: status === 'Pending' ? null : hg, pick: pickSide, pick_text: x.pick, pick_pct: x.pick_pct, conf: x.confidence, gp_pick: x.goals_play && x.goals_play.pct ? x.goals_play.pick : '', gp_pct: x.goals_play ? x.goals_play.pct : null, gp_hit: '', btts_pick: x.btts_pick, p_btts: x.p_btts, ou_pick: x.ou_pick, p_o25: x.p_o25, total_lean: /over|under/i.test(x.ou_pick) ? x.ou_pick : 'Coin toss', posted_total: 2.5, proj_total: x.xg_total, proj_score: x.proj_score, winner_hit: '', total_hit: '', btts_hit: '', auto: true };
    if (status === 'Final') {
      const res = hg > ag ? hc : ag > hg ? ac : 'Draw';
      row.winner_hit = res === pickSide ? 'hit' : 'miss';
      if (row.gp_pick) { const t = hg + ag, both = hg > 0 && ag > 0; const ok = { 'Over 1.5': t > 1, 'Under 1.5': t < 2, 'Over 2.5': t > 2, 'Under 2.5': t < 3, 'Over 3.5': t > 3, 'Under 3.5': t < 4, 'Both score': both, 'Not both': !both }[row.gp_pick]; row.gp_hit = ok == null ? '' : ok ? 'hit' : 'miss'; }
      row.btts_hit = /^(Both score|Not both)$/.test(x.btts_pick || '') ? ((x.btts_pick === 'Both score') === (hg > 0 && ag > 0) ? 'hit' : 'miss') : '';
      row.total_hit = totalHit(row.total_lean.replace(' 2.5', ''), hg + ag, 2.5);
      row.verdict = (row.gp_hit ? `${tick(row.gp_hit)} Main play ${row.gp_pick} (${row.gp_pct}%). ` : '') + `${tick(row.winner_hit)} Picked ${x.pick} (${x.pick_pct}%, ${x.confidence}): finished ${x.home} ${hg}-${ag} ${x.away}. ` + (row.btts_hit ? `${tick(row.btts_hit)} ${x.btts_pick}.` : '') + (row.total_hit ? ` ${tick(row.total_hit)} ${x.ou_pick}.` : '');
      row.factors = [`Score: we projected ${x.proj_score}, it finished ${hg}-${ag}.`];
    }
    mergeRow(hist, row); n++;
  }
  return n;
}

async function gradeUfc(hist) {
  const fights = read('ufcfights.json'), ufcp = read('ufcp.json');
  let n = 0;
  const methodFromProfile = (name, opp, date) => { const p = ufcp.find((r) => norm(r.name) === norm(name)); if (!p) return null; try { const f = JSON.parse(p.f).find((q) => norm(q[3]) === norm(opp) && Math.abs(new Date(q[0]) - new Date(date)) < 3 * 86400000); return f ? { method: f[7] || f[6], round: f[8], clock: f[9] } : null; } catch (e) { return null; } };
  for (const f of fights) {
    const day = normDay(f.date);
    const ev = (await events('mma/ufc', day)).find((e) => (e.competitions || []).some((c) => c.competitors.some((q) => norm(q.athlete && q.athlete.displayName) === norm(f.a))));
    if (!ev) continue;
    const c = ev.competitions.find((cc) => cc.competitors.some((q) => norm(q.athlete && q.athlete.displayName) === norm(f.a)) && cc.competitors.some((q) => norm(q.athlete && q.athlete.displayName) === norm(f.b)));
    if (!c) continue;
    const status = stateOf(c);
    const w = c.competitors.find((q) => q.winner);
    const row = { sport: 'ufc', date: day, id: f.id, event: f.event_name, away: f.a, home: f.b, away_name: f.a, home_name: f.b, kick: f.kick, status, away_pts: null, home_pts: null, pick: f.pick, pick_pct: f.pick_pct, conf: f.conf, winner_hit: '', auto: true };
    if (status === 'Final') {
      if (w) {
        const winner = w.athlete.displayName, loser = c.competitors.find((q) => q !== w).athlete.displayName;
        const m = methodFromProfile(winner, loser, ev.date) || {};
        const rounds = f.rounds || (c.format && c.format.regulation && c.format.regulation.periods) || 3;
        const how = m.method || (c.status.period >= rounds && c.status.displayClock === '5:00' ? 'Decision' : 'Finish');
        row.result = norm(winner) === norm(f.a) ? f.a : norm(winner) === norm(f.b) ? f.b : winner;
        row.method = how; row.round = m.round || c.status.period; row.clock = m.clock || c.status.displayClock;
        row.winner_hit = f.pick ? (norm(row.result) === norm(f.pick) ? 'hit' : 'miss') : '';
        row.verdict = (f.pick ? `${tick(row.winner_hit)} Picked ${f.pick} (${f.pick_pct}%, ${f.conf}): ` : 'No pick: ') + `${row.result} won by ${how}, round ${row.round} (${row.clock}).`;
        Object.assign(f, { status: 'Final', result: row.result, method: how });
      } else { row.result = 'Draw or no contest'; row.verdict = 'Draw or no contest: not graded.'; Object.assign(f, { status: 'Final', result: 'Draw/NC' }); }
    }
    if (!f.pick && status !== 'Final') continue;
    mergeRow(hist, row); n++;
  }
  write('ufcfights.json', fights);
  return n;
}

(async () => {
  const hist = read('history.json'), final = read('final.json');
  const counts = { nba: await gradeNba(hist, final), nfl: await gradeNfl(hist), fb: await gradeFootball(hist), ufc: await gradeUfc(hist) };
  write('history.json', hist); write('final.json', final);
  // "Last week's results" on the NFL page: the latest NFL week's finals (games within 6 days of
  // the most recent one), in the page's shape {away, home, away_pts, home_pts, date: 'MM-DD'}.
  const nflFin = hist.filter((h) => h.sport === 'nfl' && h.status === 'Final');
  if (nflFin.length) {
    const t = (h) => { const [, d, m] = normDay(h.date).split(' '); return new Date(`${m} ${d} ${yearOf(m)}`).getTime(); };
    const last = Math.max(...nflFin.map(t));
    const wk = nflFin.filter((h) => last - t(h) <= 6 * 86400000).sort((a, b) => t(a) - t(b));
    write('nflresults.json', wk.map((h) => { const d = new Date(t(h)); return { away: h.away, home: h.home, away_pts: h.away_pts, home_pts: h.home_pts, date: `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }; }));
  }
  const fin = hist.filter((h) => h.status === 'Final');
  const rec = (sp) => { const r = fin.filter((h) => h.sport === sp && (h.winner_hit === 'hit' || h.winner_hit === 'miss')); return `${r.filter((h) => h.winner_hit === 'hit').length}/${r.length}`; };
  console.log(`Checked ${JSON.stringify(counts)}. History: ${hist.length} rows, ${fin.length} final. Winners right so far: NBA ${rec('nba')}, NFL ${rec('nfl')}, football ${rec('fb')}, UFC ${rec('ufc')}.`);
})().catch((e) => { console.error(e); process.exit(1); });
