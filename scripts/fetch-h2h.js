// Older head-to-head games for the player chart's "vs next opponent · last 10" button.
// Usage: npm run fetch:h2h   (run after fetch-gamelogs.js; reads public/data/pgl.json)
//
// pgl.json holds every game of the last three seasons. For each player this script walks back
// through older seasons and keeps ONLY the games needed to reach 10 against each opponent;
// every other old game is dropped straight away, so nothing extra is stored.
// It stops for a player once every opponent has 10 games, at MAX_BACK seasons, or when his
// career runs out (two empty seasons in a row).
//
// Writes public/data/h2h.json: [{pid, g}], compact, only what the chart uses (";"-separated, newest first):
//   yymmdd,opp,ha+res,score,min,pts,reb,ast,tpm,stl,blk     e.g. 240115,TOR,HW,118-104,36,30,8,9,4,1,0
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'public', 'data');
const NEED = 10;
const FIRST_FULL = 2025; // pgl.json already has seasons ending 2025, 2026, 2027 (2024-25 onward)
const MAX_BACK = 8;      // look at most 8 older seasons (back to 2016-17)
const CODE = { GS: 'GSW', NO: 'NOP', NY: 'NYK', SA: 'SAS', UTAH: 'UTA', WSH: 'WAS', NJ: 'BKN', NOH: 'NOP', SEA: 'OKC', PHO: 'PHX' };
const code = (a) => CODE[a] || a;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url, { headers: { 'User-Agent': 'StatSniper/1.0' } }); if (r.status === 404) return null; if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } catch (e) { if (i === tries - 1) return null; await sleep(500 * 2 ** i); }
  }
}
async function pool(items, n, fn) { const out = new Array(items.length); let next = 0; await Promise.all(Array.from({ length: n }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } })); return out; }
const usDate = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const seasonLabel = (s) => `${s - 1}-${String(s).slice(2)}`;

async function seasonGames(pid, season, teamIdToCode) {
  const r = await getJson(`https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${pid}/gamelog?season=${season}`);
  if (!r || !r.events || !r.seasonTypes) return [];
  const idx = Object.fromEntries((r.names || []).map((n, i) => [n, i]));
  const games = [];
  for (const st of r.seasonTypes) {
    if (/preseason/i.test(st.displayName || '')) continue;
    for (const cat of st.categories || []) {
      for (const ev of cat.events || []) {
        const e = r.events[ev.eventId]; if (!e) continue;
        const s = ev.stats || [];
        const num = (k) => { const v = s[idx[k]]; return v == null || v === '' ? 0 : Number(v); };
        const pair = (k) => String(s[idx[k]] || '0-0').split('-').map(Number);
        const [fgm, fga] = pair('fieldGoalsMade-fieldGoalsAttempted');
        const [tpm] = pair('threePointFieldGoalsMade-threePointFieldGoalsAttempted');
        const home = e.atVs === 'vs';
        const own = home ? e.homeTeamScore : e.awayTeamScore, opp = home ? e.awayTeamScore : e.homeTeamScore;
        const g = [usDate(e.gameDate), seasonLabel(season), teamIdToCode[home ? e.homeTeamId : e.awayTeamId] || '', code((e.opponent && e.opponent.abbreviation) || '?'), home ? 'H' : 'A', e.gameResult || '', `${own}-${opp}`,
          num('minutes'), num('points'), num('totalRebounds'), num('assists'), tpm, num('steals'), num('blocks'), num('turnovers'), fgm, fga];
        if (g[7] > 0) games.push(g); // played minutes only, like the chart
      }
    }
  }
  return games.sort((a, b) => (a[0] < b[0] ? 1 : -1));
}

(async () => {
  const pgl = JSON.parse(fs.readFileSync(path.join(DATA, 'pgl.json'), 'utf8'));
  const t = await getJson('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams');
  const teams = t.sports[0].leagues[0].teams.map((x) => x.team);
  const teamIdToCode = Object.fromEntries(teams.map((x) => [x.id, code(x.abbreviation)]));
  const ALL = teams.map((x) => code(x.abbreviation));
  let done = 0, req = 0, seen = 0;
  const rows = await pool(pgl, 8, async (p) => {
    const cnt = {}; ALL.forEach((c) => { cnt[c] = 0; });
    String(p.g || '').split(';').filter(Boolean).forEach((s) => { const a = s.split(','); if (Number(a[7]) > 0 && a[3] in cnt) cnt[a[3]]++; });
    const kept = []; let empty = 0;
    for (let k = 1; k <= MAX_BACK; k++) {
      const short = ALL.filter((c) => c !== p.team && cnt[c] < NEED);
      if (!short.length) break;
      const gs = await seasonGames(p.pid, FIRST_FULL - k, teamIdToCode); req++; seen += gs.length;
      if (!gs.length) { if (++empty >= 2) break; continue; }
      empty = 0;
      for (const g of gs) if (g[3] in cnt && cnt[g[3]] < NEED) { kept.push(g); cnt[g[3]]++; } // everything else is dropped here
    }
    if (++done % 50 === 0) console.log(`  ${done}/${pgl.length}`);
    return kept.length ? { pid: p.pid, g: kept.sort((a, b) => (a[0] < b[0] ? 1 : -1)).map((g) => [g[0].slice(2).replace(/-/g, ''), g[3], g[4] + g[5], g[6], g[7], g[8], g[9], g[10], g[11], g[12], g[13]].join(',')).join(';') } : null;
  });
  const out = rows.filter(Boolean);
  const file = path.join(DATA, 'h2h.json');
  fs.writeFileSync(file, JSON.stringify(out));
  const keptN = out.reduce((s, r) => s + r.g.split(';').length, 0);
  console.log(`h2h: ${req} season logs read, ${seen} older games seen, ${keptN} kept for ${out.length} players, ${seen - keptN} dropped; ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
})().catch((e) => { console.error(e); process.exit(1); });
