// Match-day extras for league games (Premier League, La Liga): the same data the Champions League
// game page gets from fetch-ucl-match.js — past meetings, last five games, projected XI from each
// club's latest league starting XI (ESPN), and injuries/suspensions (FotMob) — written as rows in
// public/data/uclx.json keyed by fixture id (the football game page reads it for any league).
// Usage: node scripts/fetch-league-match.js "Mon 9 Nov"     (Sydney day of the fixtures)
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'public', 'data');
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/';
const SUM = 'https://site.web.api.espn.com/apis/site/v2/sports/soccer/all/summary?event=';
const EURO = ['uefa.champions', 'uefa.europa', 'uefa.europa.conf'];
const FIRST = 2014, LAST = 2026;
const CUP = /cup|copa|pokal|coupe|coppa|kupa|ta[cç]a|beker|carabao|super|trophy|shield|friendly/i;

const read = (f, d = []) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch (e) { return d; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url, { headers: { 'User-Agent': 'StatSniper/1.0' } }); if (r.status === 404) return null; if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } catch (e) { if (i === tries - 1) { console.warn('failed', url, e.message); return null; } await sleep(600 * 2 ** i); }
  }
}
async function pool(items, n, fn) { const out = new Array(items.length); let next = 0; await Promise.all(Array.from({ length: n }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } })); return out; }
const ukDate = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const longDate = (iso) => new Intl.DateTimeFormat('en-AU', { timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
const COMP = { 'uefa.champions': 'Champions League', 'uefa.europa': 'Europa League', 'uefa.europa.conf': 'Conference League' };
const UA = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36' };
async function fm(url) { for (let i = 0; i < 3; i++) { try { const r = await fetch('https://www.fotmob.com/api/data/' + url, { headers: UA }); if (r.ok) return await r.json(); } catch (e) {} await sleep(800 * 2 ** i); } console.warn('fotmob failed', url); return null; }
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\b(fc|cf|ac|as|sc|fk|sk|afc|club|de|cp|rc|vfb|vfl|rb)\b/g, ' ').replace(/\s+/g, ' ').trim();
const nameSim = (a, b) => { a = norm(a); b = norm(b); if (!a || !b) return 0; if (a === b || a.includes(b) || b.includes(a)) return 1; const A = new Set(a.split(' ')), B = b.split(' '); return B.filter((w) => w.length > 2 && A.has(w)).length / Math.max(1, Math.min(A.size, B.length)); };
// Same person in two feeds: full name, or surname plus first initial, or shirt number plus surname.
const samePlayer = (n1, n2, j1, j2) => { const a = norm(n1), b = norm(n2); if (!a || !b) return false; if (a === b) return true; const sa = a.split(' ').pop(), sb = b.split(' ').pop(); if (sa === sb && (a[0] === b[0] || (j1 && String(j1) === String(j2)))) return true; return a.split(' ').length === 1 && b.split(' ').includes(a) || b.split(' ').length === 1 && a.split(' ').includes(b); };
const sc = (x) => Number(x && typeof x.score === 'object' ? x.score.value : x && x.score);

async function meetings(H, A) {
  const leagues = [...EURO]; if (H.lg === A.lg && !EURO.includes(H.lg)) leagues.push(H.lg);
  const jobs = []; leagues.forEach((lg) => { for (let s = FIRST; s <= LAST; s++) jobs.push([lg, s]); });
  const seen = new Map();
  await pool(jobs, 6, async ([lg, s]) => {
    const r = await getJson(`${SITE}${lg}/teams/${H.id}/schedule?season=${s}`);
    for (const ev of (r && r.events) || []) {
      const c = ev.competitions && ev.competitions[0]; if (!c || !c.status || !c.status.type || !c.status.type.completed) continue;
      const ids = c.competitors.map((x) => x.team && x.team.id); if (!ids.includes(String(A.id))) continue;
      const h = c.competitors.find((x) => x.homeAway === 'home'), a = c.competitors.find((x) => x.homeAway === 'away');
      const hg = sc(h), ag = sc(a); if (!Number.isFinite(hg) || !Number.isFinite(ag)) continue;
      seen.set(ev.id, [ukDate(ev.date), COMP[lg] || (ev.league && ev.league.name) || 'League', h.team.id === String(H.id) ? H.code : A.code, h.team.id === String(H.id) ? A.code : H.code, hg, ag]);
    }
  });
  return [...seen.values()].sort((x, y) => (x[0] < y[0] ? 1 : -1)).slice(0, 12);
}

async function xiOf(team, events) {
  // events: lastFiveGames entries, oldest first.
  const sums = await pool(events, 3, (e) => getJson(SUM + e.id));
  const starts = {};
  let pick = null;
  for (let i = events.length - 1; i >= 0; i--) {
    const s = sums[i], e = events[i]; if (!s) continue;
    const ro = (s.rosters || []).find((r) => r.team && r.team.id === String(team.id)); if (!ro || !(ro.roster || []).length) continue;
    ro.roster.filter((p) => p.starter).forEach((p) => { starts[p.athlete.id] = (starts[p.athlete.id] || 0) + 1; });
    if (!pick && !CUP.test(e.leagueName || '')) pick = { ro, e };
  }
  if (!pick) return null;
  const players = pick.ro.roster.filter((p) => p.starter).sort((a, b) => (a.formationPlace || 99) - (b.formationPlace || 99))
    .map((p) => [String(p.athlete.id), p.athlete.displayName, (p.position && p.position.abbreviation) || '', p.jersey || '', Number(p.formationPlace) || 0, starts[p.athlete.id] || 0]);
  const opp = pick.e.opponent && pick.e.opponent.displayName;
  return { formation: pick.ro.formation || '', from: `${longDate(pick.e.gameDate)} ${pick.e.atVs === '@' ? 'at' : 'vs'} ${opp} (${(pick.e.leagueName || '').replace(/^\d{4}-\d{2} /, '')})`, players };
}

const SLUG = { 'Premier League': 'eng.1', 'La Liga': 'esp.1' };
const DAY = process.argv[2];
(async () => {
  if (!DAY) { console.error('Usage: node scripts/fetch-league-match.js "Mon 9 Nov"'); process.exit(1); }
  const fixtures = read('fixtures.json'), table = read('table.json'), socp = read('socp.json');
  const abbr = (name) => { const t = table.find((q) => q.team === name); return t ? t.abbr : name.slice(0, 3).toUpperCase(); };
  const todo = fixtures.filter((f) => SLUG[f.league] && String(f.time).startsWith(DAY));
  const evs = {}; const fmDays = new Map();
  const fmMatches = async (iso) => { const d = iso.slice(0, 10).replace(/-/g, ''); if (!fmDays.has(d)) { const j = await fm('matches?date=' + d); fmDays.set(d, ((j && j.leagues) || []).flatMap((l) => l.matches || [])); } return fmDays.get(d); };
  const now = Date.now();
  for (const lg of new Set(todo.map((f) => SLUG[f.league]))) {
    evs[lg] = [];
    for (let k = -1; k <= 2; k++) { const d = new Date(now + k * 86400000).toISOString().slice(0, 10).replace(/-/g, ''); const r = await getJson(`${SITE}${lg}/scoreboard?dates=${d}`); evs[lg].push(...((r && r.events) || [])); }
  }
  let ux = read('uclx.json'); const rows = [];
  const checked = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', hour12: true }).format(new Date()) + ' Sydney';
  for (const f of todo) {
    const lg = SLUG[f.league];
    const ev = evs[lg].map((e) => { const c = e.competitions[0]; const h = c.competitors.find((x) => x.homeAway === 'home'), a = c.competitors.find((x) => x.homeAway === 'away'); return [e, h, a, nameSim(h.team.displayName, f.home) + nameSim(a.team.displayName, f.away)]; }).sort((p, q) => q[3] - p[3])[0];
    if (!ev || ev[3] < 1.5) { console.warn('no ESPN event for', f.id); continue; }
    const [E, hc, ac] = ev;
    const H = { id: hc.team.id, code: abbr(f.home), name: f.home, lg }, A = { id: ac.team.id, code: abbr(f.away), name: f.away, lg };
    const s = await getJson(SUM + E.id);
    const l5raw = {}; ((s && s.lastFiveGames) || []).forEach((t) => { l5raw[t.team.id] = (t.events || []).slice().sort((a, b) => (a.gameDate < b.gameDate ? -1 : 1)); });
    const l5 = {}, xi = {};
    // Confirmed lineups if ESPN already has them for this match.
    const conf = {}; ((s && s.rosters) || []).forEach((ro) => { const st = (ro.roster || []).filter((p) => p.starter); if (st.length >= 11) conf[ro.team.id] = { formation: ro.formation || '', from: 'Confirmed lineup (ESPN)', players: st.sort((a, b) => (a.formationPlace || 99) - (b.formationPlace || 99)).map((p) => [String(p.athlete.id), p.athlete.displayName, (p.position && p.position.abbreviation) || '', p.jersey || '', Number(p.formationPlace) || 0, 0]) }; });
    for (const T of [H, A]) {
      const list = l5raw[String(T.id)] || [];
      l5[T.code] = list.slice().reverse().map((e) => { const home = e.atVs !== '@'; const gf = Number(home ? e.homeTeamScore : e.awayTeamScore), ga = Number(home ? e.awayTeamScore : e.homeTeamScore); return [ukDate(e.gameDate), (e.opponent && e.opponent.displayName) || '?', home ? 'H' : 'A', gf, ga, e.gameResult || (gf > ga ? 'W' : gf < ga ? 'L' : 'D'), (e.leagueName || '').replace(/^\d{4}-\d{2} /, '')]; });
      xi[T.code] = conf[String(T.id)] || await xiOf(T, list);
    }
    const isConf = !!(conf[String(H.id)] && conf[String(A.id)]);
    const h2h = await meetings(H, A);
    const inj = {}; let injSrc = '';
    const fmm = (await fmMatches(E.date)).map((m) => [m, nameSim(m.home.name, H.name) + nameSim(m.away.name, A.name)]).sort((a, b) => b[1] - a[1])[0];
    if (fmm && fmm[1] >= 1.5) {
      const md = await fm('matchDetails?matchId=' + fmm[0].id);
      const lu = md && md.content && md.content.lineup;
      for (const [T, side] of [[H, 'homeTeam'], [A, 'awayTeam']]) {
        const t = lu && lu[side]; if (!t) continue;
        const sq = await fm('teams?id=' + t.id);
        const squad = ((sq && sq.squad && sq.squad.squad) || []).flatMap((g) => g.members || []).filter((m) => m.role && m.role.key !== 'coach');
        const mine = socp.filter((p) => p.team === T.code);
        const espnOf = (name, shirt) => { const p = mine.find((q) => samePlayer(q.player, name, q.jersey, shirt)); return p ? String(p.pid) : ''; };
        inj[T.code] = (t.unavailable || []).map((u) => { const un = u.unavailability || {}; const sm = squad.find((m) => m.id === u.id) || {}; return [espnOf(u.name, sm.shirtNumber), u.name, un.type === 'suspension' ? 'Suspended' : un.type === 'injury' ? 'Injured' : (un.type || 'Unavailable').replace(/^./, (c) => c.toUpperCase()), un.expectedReturn || '', (un.expectedReturnDate || '').slice(0, 10), u.id, u.age || null]; });
        if (xi[T.code]) xi[T.code].players.forEach((p) => { const m = squad.find((q) => samePlayer(q.name, p[1], q.shirtNumber, p[3])); p[6] = m ? m.id : null; });
      }
      injSrc = 'FotMob, checked ' + checked;
    } else console.warn('no FotMob match for', f.id);
    rows.push({ id: f.id, ev: E.id, h2h, l5, xi, inj, injSrc });
    if (h2h.length) {
      const w = h2h.filter((m) => (m[2] === H.code ? m[4] > m[5] : m[5] > m[4])).length, l = h2h.filter((m) => (m[2] === H.code ? m[4] < m[5] : m[5] < m[4])).length, dr = h2h.length - w - l;
      const last = h2h[0];
      f.h2h_text = `${h2h.length} meeting${h2h.length > 1 ? 's' : ''} in league and European games since 2014-15: ${f.home} ${w} win${w === 1 ? '' : 's'}, ${dr} draw${dr === 1 ? '' : 's'}, ${f.away} ${l} win${l === 1 ? '' : 's'}. Last: ${last[2] === H.code ? f.home : f.away} ${last[4]}-${last[5]} ${last[2] === H.code ? f.away : f.home}, ${longDate(last[0] + 'T12:00Z')} (${last[1]}).`;
    } else f.h2h_text = 'These clubs have not met in league or European games since 2014-15 (ESPN records).';
    if (xi[H.code] || xi[A.code]) {
      const line = (x) => (x ? x.players.map((p) => p[1].split(' ').slice(-1)[0]).join(', ') : 'Not available');
      f.home_xi = line(xi[H.code]); f.away_xi = line(xi[A.code]);
      f.lineup_status = isConf ? 'Confirmed' : 'Projected';
      f.lineup_source = isConf ? 'Confirmed lineups (ESPN)' : "Projected from each club's latest league starting XI (ESPN); injuries from FotMob";
    }
    const outTxt = (c) => (inj[c] || []).map((r) => `${r[1]} (${r[2] === 'Suspended' ? 'suspended' : (r[3] || r[2]).toLowerCase()})`).join(', ');
    if (inj[H.code]) f.home_news = inj[H.code].length ? 'Out or doubtful: ' + outTxt(H.code) : 'No injuries or suspensions listed';
    if (inj[A.code]) f.away_news = inj[A.code].length ? 'Out or doubtful: ' + outTxt(A.code) : 'No injuries or suspensions listed';
    f.checked = checked;
    console.log(`${f.id}: ${h2h.length} meetings, XI ${xi[H.code] ? xi[H.code].formation : '-'} / ${xi[A.code] ? xi[A.code].formation : '-'} (${f.lineup_status}), out ${(inj[H.code] || []).length} / ${(inj[A.code] || []).length}`);
  }
  const ids = new Set(rows.map((r) => r.id));
  ux = ux.filter((r) => !ids.has(r.id)).concat(rows);
  fs.writeFileSync(path.join(DATA, 'uclx.json'), JSON.stringify(ux));
  fs.writeFileSync(path.join(DATA, 'fixtures.json'), JSON.stringify(fixtures));
  console.log(`Wrote ${rows.length} league fixtures into data/uclx.json`);
})().catch((e) => { console.error(e); process.exit(1); });
