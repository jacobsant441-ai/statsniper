// NBA play-by-play extras for the player page: 1st-quarter and 1st-half stats per game, shooting
// zones, shot types and scoring types per player, and the same allowed by each defence (with ranks).
// Usage: npm run fetch:pbp   (incremental: games already in public/data/pbp.json are skipped)
//
// Source: ESPN game summaries (every shot has court coordinates and a type such as "Pullup Jump Shot").
// Current season only. Writes public/data/pbp.json, an array of rows:
//   {k:'meta', season, done:[event ids], at}
//   {k:'p', pid, team, n, z, st, pt, g}   one per player
//   {k:'t', team, n, z, st, pt, rk}       one per team: what its defence allowed, rk = ranks (1 = stingiest)
// z  (zones):  ra (restricted area), paint, mid, lc (left corner 3), rc (right corner 3), atb (above the break 3): [att, made]
// st (shot types): cs (catch and shoot jumper 10+ ft), close (under 10 ft), pu (pull-up / off the dribble 10+ ft): [att, made]
// pt (points by type): ft, rim (layups, dunks, tips), flt (floaters), pu (pull-ups, step-backs), cs (catch and shoot), post (hooks, turnarounds, fadeaways)
// g  per game, newest first, ";"-separated: date,q1pts,q1reb,q1ast,h1pts,h1reb,h1ast,q1tpm
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'public', 'data');
const OUT = path.join(DATA, 'pbp.json');
const SEASON = '2026-27', START = '2026-10-20';
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/';
const CODE = { GS: 'GSW', NO: 'NOP', NY: 'NYK', SA: 'SAS', UTAH: 'UTA', WSH: 'WAS' };
const code = (a) => CODE[a] || a;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url, { headers: { 'User-Agent': 'StatSniper/1.0' } }); if (r.status === 404) return null; if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } catch (e) { if (i === tries - 1) { console.warn('failed', url, e.message); return null; } await sleep(600 * 2 ** i); }
  }
}
async function pool(items, n, fn) { const out = new Array(items.length); let next = 0; await Promise.all(Array.from({ length: n }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } })); return out; }
const usDate = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

const Z = ['ra', 'paint', 'mid', 'lc', 'rc', 'atb'], ST = ['cs', 'close', 'pu'], PT = ['ft', 'rim', 'flt', 'pu', 'cs', 'post'];
const blank = () => ({ z: Object.fromEntries(Z.map((k) => [k, [0, 0]])), st: Object.fromEntries(ST.map((k) => [k, [0, 0]])), pt: Object.fromEntries(PT.map((k) => [k, 0])) });
const add = (a, b) => { Z.forEach((k) => { a.z[k][0] += b.z[k][0]; a.z[k][1] += b.z[k][1]; }); ST.forEach((k) => { a.st[k][0] += b.st[k][0]; a.st[k][1] += b.st[k][1]; }); PT.forEach((k) => { a.pt[k] += b.pt[k]; }); };

function zoneOf(p) {
  const c = p.coordinate || {}, x = Number(c.x), y = Number(c.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < -2 || x > 52 || y < -6 || y > 60) return null;
  if (p.pointsAttempted === 3) return y <= 8.5 ? (x < 25 ? 'lc' : 'rc') : 'atb';
  const d = Math.hypot(x - 25, y);
  if (d <= 4) return 'ra';
  if (Math.abs(x - 25) <= 8 && y <= 14) return 'paint';
  return 'mid';
}
const distOf = (p) => { const m = String(p.text || '').match(/(\d+)-foot/); if (m) return Number(m[1]); const c = p.coordinate || {}; const d = Math.hypot(Number(c.x) - 25, Number(c.y)); return Number.isFinite(d) && d < 60 ? d : 0; };
function kind(p) {
  const t = (p.type && p.type.text) || '', made = !!p.scoringPlay;
  const d = distOf(p);
  const offDribble = /pullup|pull-up|step back|stepback|running jump|running pull/i.test(t);
  const post = /hook|turnaround|fade/i.test(t);
  const rim = /layup|dunk|tip|putback|alley|finger roll/i.test(t);
  const flt = /float/i.test(t);
  const st = d < 10 ? 'close' : offDribble || post ? 'pu' : 'cs';
  const pt = rim ? 'rim' : flt ? 'flt' : post ? 'post' : offDribble ? 'pu' : d < 10 ? 'rim' : 'cs';
  return { made, st, pt, z: zoneOf(p), val: made ? Number(p.scoreValue) || 0 : 0 };
}

(async () => {
  let prev = [];
  try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) {}
  const meta = prev.find((r) => r.k === 'meta' && r.season === SEASON) || { k: 'meta', season: SEASON, done: [] };
  const P = new Map(prev.filter((r) => r.k === 'p').map((r) => [r.pid, r]));
  const T = new Map(prev.filter((r) => r.k === 't').map((r) => [r.team, r]));
  const done = new Set(meta.done);
  // Completed games from the season start to today.
  const days = []; for (let d = new Date(START + 'T12:00:00Z'); d <= new Date(); d = new Date(d.getTime() + 86400000)) days.push(d.toISOString().slice(0, 10).replace(/-/g, ''));
  const evs = (await pool(days, 6, async (d) => { const r = await getJson(`${SITE}scoreboard?dates=${d}`); return ((r && r.events) || []).filter((e) => e.status && e.status.type && e.status.type.completed && e.season && e.season.type !== 1); })).flat();
  const todo = evs.filter((e) => !done.has(e.id));
  console.log(`${evs.length} completed games, ${todo.length} new`);
  let n = 0;
  await pool(todo, 6, async (e) => {
    const s = await getJson(`${SITE}summary?event=${e.id}`); if (!s || !(s.plays || []).length) return;
    const tm = Object.fromEntries(((s.boxscore && s.boxscore.players) || []).map((t) => [t.team.id, code(t.team.abbreviation)]));
    const ids = Object.keys(tm); if (ids.length !== 2) return;
    const teamOf = {}; (s.boxscore.players || []).forEach((t) => (t.statistics || []).forEach((st) => (st.athletes || []).forEach((a) => { teamOf[a.athlete.id] = tm[t.team.id]; })));
    const date = usDate(e.date);
    const per = {}; // pid -> {agg, q1:[p,r,a,tpm], h1:[p,r,a]}
    const me = (pid) => (per[pid] = per[pid] || { agg: blank(), q1: [0, 0, 0, 0], h1: [0, 0, 0] });
    const allowed = Object.fromEntries(ids.map((id) => [tm[id], blank()])); // keyed by the DEFENDING team
    for (const p of s.plays) {
      const who = (p.participants || []).map((x) => x.athlete && x.athlete.id).filter(Boolean);
      const q = (p.period && p.period.number) || 0, t = (p.type && p.type.text) || '';
      if (/rebound/i.test(t) && who[0]) { const m = me(who[0]); if (q === 1) m.q1[1]++; if (q <= 2) m.h1[1]++; continue; }
      if (!p.shootingPlay || !who[0]) continue;
      const shooterTeam = teamOf[who[0]] || tm[p.team && p.team.id]; const defTeam = tm[ids.find((id) => tm[id] !== shooterTeam)];
      const m = me(who[0]);
      if (/free throw/i.test(t)) {
        const v = p.scoringPlay ? 1 : 0; m.agg.pt.ft += v; if (defTeam) allowed[defTeam].pt.ft += v;
        if (q === 1) m.q1[0] += v; if (q <= 2) m.h1[0] += v; continue;
      }
      const k = kind(p);
      [m.agg, defTeam && allowed[defTeam]].filter(Boolean).forEach((a) => {
        if (k.z) { a.z[k.z][0]++; if (k.made) a.z[k.z][1]++; }
        a.st[k.st][0]++; if (k.made) a.st[k.st][1]++;
        a.pt[k.pt] += k.val;
      });
      if (q === 1) { m.q1[0] += k.val; if (k.made && p.pointsAttempted === 3) m.q1[3]++; }
      if (q <= 2) m.h1[0] += k.val;
      if (k.made && who[1] && /assist/i.test(p.text || '')) { const a = me(who[1]); if (q === 1) a.q1[2]++; if (q <= 2) a.h1[2]++; }
    }
    for (const [pid, v] of Object.entries(per)) {
      if (!teamOf[pid]) continue;
      const r = P.get(pid) || { k: 'p', pid, team: teamOf[pid], n: 0, ...blank(), g: '' };
      add(r, v.agg); r.n++; r.team = teamOf[pid];
      r.g = [[date, ...v.q1.slice(0, 3), ...v.h1, v.q1[3]].join(','), ...String(r.g || '').split(';').filter(Boolean)].sort((a, b) => (a < b ? 1 : -1)).join(';');
      P.set(pid, r);
    }
    for (const [team, a] of Object.entries(allowed)) { const r = T.get(team) || { k: 't', team, n: 0, ...blank() }; add(r, a); r.n++; T.set(team, r); }
    done.add(e.id);
    if (++n % 20 === 0) console.log(`  ${n}/${todo.length}`);
  });
  // Defence ranks (1 = stingiest): FG% allowed per zone and shot type, points allowed per game per scoring type.
  const teams = [...T.values()];
  const rankBy = (val) => { const s = teams.map((t) => [t.team, val(t)]).filter((x) => x[1] != null).sort((a, b) => a[1] - b[1]); return Object.fromEntries(s.map(([t], i) => [t, i + 1])); };
  const pct = (a) => (a[0] ? a[1] / a[0] : null);
  const rk = {};
  Z.forEach((k) => { rk['z_' + k] = rankBy((t) => pct(t.z[k])); });
  ST.forEach((k) => { rk['st_' + k] = rankBy((t) => pct(t.st[k])); });
  PT.forEach((k) => { rk['pt_' + k] = rankBy((t) => (t.n ? t.pt[k] / t.n : null)); });
  teams.forEach((t) => { t.rk = Object.fromEntries(Object.entries(rk).map(([k, m]) => [k, m[t.team] || null])); });
  meta.done = [...done]; meta.at = new Date().toISOString();
  const out = [meta, ...teams.sort((a, b) => a.team.localeCompare(b.team)), ...[...P.values()].sort((a, b) => a.pid.localeCompare(b.pid))];
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`pbp: ${done.size} games, ${P.size} players, ${T.size} teams (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
})().catch((e) => { console.error(e); process.exit(1); });
