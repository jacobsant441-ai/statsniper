// Match-day extras for the Champions League game page: past meetings, last five games and a
// projected XI for both clubs, from ESPN's public feed.
// Usage: npm run fetch:uclx   (run after fetch-ucl.js; reads fixtures.json and ucl_teams.json)
//
// Writes public/data/uclx.json, one row per Champions League fixture:
//   {id, ev, h2h: [[date, comp, homeCode, awayCode, hg, ag]] newest first (up to 12),
//    l5: {CODE: [[date, oppName, ha, gf, ga, res, comp]]},
//    xi: {CODE: {formation, from, players: [[id, name, pos, jersey, place, starts5, fotmobId]]}},
//    inj: {CODE: [[espnId, name, type, expectedReturn, returnDate, fotmobId, age]]}, injSrc}
// and refreshes h2h_text / h2h_season and the lineup fields on the fixture rows.
//
// Head-to-head: every completed meeting ESPN has (2014-15 onward) in the Champions League,
// Europa League, Conference League and, for clubs from the same country, their league.
// Projected XI: the starters from each club's latest league or Champions League match (cup
// games are skipped because clubs rotate), with how many of the last five games each started.
// Injuries and suspensions: FotMob's match page ('unavailable' players). ESPN has no football
// injury feed. FotMob ids are kept so fetch_headshots.py uclx can add photos ESPN lacks.
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

(async () => {
  const fixtures = read('fixtures.json'), teams = read('ucl_teams.json');
  const byName = new Map(teams.map((t) => [t.name, t]));
  const ucl = fixtures.filter((f) => f.league === 'Champions League');
  // ESPN event ids for the fixtures, from the scoreboard around their dates.
  const evs = [];
  const days = new Set(); const now = new Date();
  for (let k = -1; k <= 9; k++) { const d = new Date(now.getTime() + k * 86400000); days.add(d.toISOString().slice(0, 10).replace(/-/g, '')); }
  for (const d of days) { const r = await getJson(`${SITE}uefa.champions/scoreboard?dates=${d}`); evs.push(...((r && r.events) || [])); }
  const fmDays = new Map();
  const fmMatches = async (iso) => { const d = iso.slice(0, 10).replace(/-/g, ''); if (!fmDays.has(d)) { const j = await fm('matches?date=' + d); fmDays.set(d, ((j && j.leagues) || []).filter((l) => l.primaryId === 42 || /champions league/i.test(l.name)).flatMap((l) => l.matches || [])); } return fmDays.get(d); };
  const socp = read('socp.json');
  const rows = [];
  for (const f of ucl) {
    const H = byName.get(f.home), A = byName.get(f.away); if (!H || !A) { console.warn('no club for', f.id); continue; }
    const ev = evs.find((e) => { const c = e.competitions[0]; const h = c.competitors.find((x) => x.homeAway === 'home'), a = c.competitors.find((x) => x.homeAway === 'away'); return h.team.id === String(H.id) && a.team.id === String(A.id); });
    if (!ev) { console.warn('no ESPN event for', f.id); continue; }
    const s = await getJson(SUM + ev.id);
    const l5raw = {}; ((s && s.lastFiveGames) || []).forEach((t) => { l5raw[t.team.id] = (t.events || []).slice().sort((a, b) => (a.gameDate < b.gameDate ? -1 : 1)); });
    const l5 = {}, xi = {};
    for (const T of [H, A]) {
      const list = l5raw[String(T.id)] || [];
      l5[T.code] = list.slice().reverse().map((e) => { const home = e.atVs !== '@'; const gf = Number(home ? e.homeTeamScore : e.awayTeamScore), ga = Number(home ? e.awayTeamScore : e.homeTeamScore); return [ukDate(e.gameDate), (e.opponent && e.opponent.displayName) || '?', home ? 'H' : 'A', gf, ga, e.gameResult || (gf > ga ? 'W' : gf < ga ? 'L' : 'D'), (e.leagueName || '').replace(/^\d{4}-\d{2} /, '')]; });
      xi[T.code] = await xiOf(T, list);
    }
    const h2h = await meetings(H, A);
    // FotMob: unavailable players and ids for photos.
    const inj = {}; let injSrc = '';
    const fmm = (await fmMatches(ev.date)).map((m) => [m, nameSim(m.home.name, H.name) + nameSim(m.away.name, A.name)]).sort((a, b) => b[1] - a[1])[0];
    if (fmm && fmm[1] >= 1) {
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
      injSrc = 'FotMob, checked ' + new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', hour: 'numeric', hour12: true }).format(new Date()) + ' Sydney';
    } else console.warn('no FotMob match for', f.id);
    rows.push({ id: f.id, ev: ev.id, h2h, l5, xi, inj, injSrc });
    // Fixture text the cards and older views use.
    if (h2h.length) {
      const w = h2h.filter((m) => (m[2] === H.code ? m[4] > m[5] : m[5] > m[4])).length, l = h2h.filter((m) => (m[2] === H.code ? m[4] < m[5] : m[5] < m[4])).length, dr = h2h.length - w - l;
      const last = h2h[0];
      f.h2h_text = `${h2h.length} meeting${h2h.length > 1 ? 's' : ''} in European and league games since 2014-15: ${f.home} ${w} win${w === 1 ? '' : 's'}, ${dr} draw${dr === 1 ? '' : 's'}, ${f.away} ${l} win${l === 1 ? '' : 's'}. Last: ${last[2] === H.code ? f.home : f.away} ${last[4]}-${last[5]} ${last[2] === H.code ? f.away : f.home}, ${longDate(last[0] + 'T12:00Z')} (${last[1]}).`;
    } else f.h2h_text = 'These clubs have not met in European or league games since 2014-15 (ESPN records).';
    if (xi[H.code] || xi[A.code]) {
      const line = (x) => (x ? x.players.map((p) => p[1].split(' ').slice(-1)[0]).join(', ') : 'Not available');
      f.home_xi = line(xi[H.code]); f.away_xi = line(xi[A.code]);
      f.lineup_status = 'Projected'; f.lineup_source = 'Projected from each club\'s latest league or Champions League starting XI (ESPN)';
    }
    console.log(`${f.id}: ${h2h.length} meetings, XI ${xi[H.code] ? xi[H.code].formation : '-'} / ${xi[A.code] ? xi[A.code].formation : '-'}, out ${(inj[H.code] || []).length} / ${(inj[A.code] || []).length}, photo ids ${[H, A].map((T) => (xi[T.code] ? xi[T.code].players.filter((p) => p[6]).length : 0)).join('/')}`);
  }
  // No Champions League match close enough to read (a quiet week): keep the saved rows instead of wiping them.
  if (rows.length || !fs.existsSync(path.join(DATA, 'uclx.json'))) fs.writeFileSync(path.join(DATA, 'uclx.json'), JSON.stringify(rows));
  fs.writeFileSync(path.join(DATA, 'fixtures.json'), JSON.stringify(fixtures));
  console.log(`Wrote ${rows.length} fixtures to data/uclx.json (${(fs.statSync(path.join(DATA, 'uclx.json')).size / 1024).toFixed(0)} KB)`);
})().catch((e) => { console.error(e); process.exit(1); });
