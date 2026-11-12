// NBA defence by court zone for each finished game: what each defence allowed from every zone in that one game,
// so the game page can compare it with the team's season average (pbp.json, from fetch-pbp.js).
// Writes public/data/gzones.json, one row per team per game:
//   {ev, day: Sydney day key ("Thu 12 Nov"), game: "AWAY-HOME", team: the DEFENDING team, opp, z: {zone: [att, made]}}
// Zones are the same as fetch-pbp.js: ra (restricted area), paint, mid, lc / rc (corner 3s), atb (above the break 3).
// Incremental: games already in the file are skipped. Looks back 3 days, or the whole season when the file is new.
// Runs in the cloud results job (every 30 minutes). Usage: node scripts/fetch-game-zones.js [days back]
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'data', 'gzones.json');
const START = '2026-10-20';
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/';
const CODE = { GS: 'GSW', NO: 'NOP', NY: 'NYK', SA: 'SAS', UTAH: 'UTA', WSH: 'WAS' };
const code = (a) => CODE[a] || a;
const Z = ['ra', 'paint', 'mid', 'lc', 'rc', 'atb'];
const sydKey = (iso) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', weekday: 'short', day: 'numeric', month: 'short' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value])); return `${p.weekday} ${p.day} ${p.month}`; };
async function getJson(url) {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(url, { headers: { 'User-Agent': 'StatSniper/1.0' } }); if (r.status === 404) return null; if (r.ok) return await r.json(); } catch (e) { /* retry */ }
    await new Promise((res) => setTimeout(res, 1000 * (i + 1)));
  }
  return null;
}
async function pool(items, n, fn) { const out = new Array(items.length); let next = 0; await Promise.all(Array.from({ length: n }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } })); return out; }
// same zone rules as fetch-pbp.js
function zoneOf(p) {
  const c = p.coordinate || {}, x = Number(c.x), y = Number(c.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < -2 || x > 52 || y < -6 || y > 60) return null;
  if (p.pointsAttempted === 3) return y <= 8.5 ? (x < 25 ? 'lc' : 'rc') : 'atb';
  const d = Math.hypot(x - 25, y);
  if (d <= 4) return 'ra';
  if (Math.abs(x - 25) <= 8 && y <= 14) return 'paint';
  return 'mid';
}

(async () => {
  let prev = []; try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { prev = []; }
  const done = new Set(prev.map((r) => r.ev));
  const back = Number(process.argv[2]) || (prev.length ? 3 : 0);
  const from = back ? new Date(Date.now() - back * 86400000) : new Date(START + 'T12:00:00Z');
  const days = []; for (let d = from; d <= new Date(Date.now() + 86400000); d = new Date(d.getTime() + 86400000)) days.push(d.toISOString().slice(0, 10).replace(/-/g, ''));
  const evs = (await pool(days, 6, async (d) => { const r = await getJson(`${SITE}scoreboard?dates=${d}`); return ((r && r.events) || []).filter((e) => e.status && e.status.type && e.status.type.completed && e.season && e.season.type !== 1); })).flat();
  const todo = evs.filter((e) => !done.has(e.id));
  const rows = [];
  await pool(todo, 6, async (e) => {
    const s = await getJson(`${SITE}summary?event=${e.id}`); if (!s || !(s.plays || []).length) return;
    const comp = e.competitions[0].competitors, A = comp.find((c) => c.homeAway === 'away'), H = comp.find((c) => c.homeAway === 'home');
    const byId = { [A.team.id]: code(A.team.abbreviation), [H.team.id]: code(H.team.abbreviation) };
    const game = byId[A.team.id] + '-' + byId[H.team.id], day = sydKey(e.date);
    const allowed = { [byId[A.team.id]]: Object.fromEntries(Z.map((k) => [k, [0, 0]])), [byId[H.team.id]]: Object.fromEntries(Z.map((k) => [k, [0, 0]])) };
    let n = 0;
    for (const p of s.plays) {
      if (!p.shootingPlay || /free throw/i.test((p.type && p.type.text) || '')) continue;
      const shooter = p.team && byId[p.team.id]; if (!shooter) continue;
      const def = shooter === byId[A.team.id] ? byId[H.team.id] : byId[A.team.id];
      const z = zoneOf(p); if (!z) continue;
      allowed[def][z][0]++; if (p.scoringPlay) allowed[def][z][1]++; n++;
    }
    if (n < 40) return; // play-by-play missing or cut short: try again next run
    for (const [team, z] of Object.entries(allowed)) rows.push({ ev: e.id, day, game, team, opp: team === byId[A.team.id] ? byId[H.team.id] : byId[A.team.id], z });
  });
  if (!rows.length && prev.length) { console.log(`gzones: no new finished games (${prev.length / 2} on file)`); return; }
  const all = prev.concat(rows).sort((a, b) => String(b.ev).localeCompare(String(a.ev)));
  fs.writeFileSync(OUT, JSON.stringify(all));
  console.log(`gzones.json: ${rows.length / 2} new games, ${all.length / 2} in all`);
})().catch((e) => { console.error(e); process.exit(1); });
