// Fetches NBA player game logs from ESPN's public stats feed into public/data/pgl.json.
// Usage: npm run fetch:gamelogs
// One row per player on a current NBA roster. `g` holds every regular-season and
// playoff game from the seasons below, newest first, one game per ";"-separated entry:
//   date,season,team,opp,ha,res,score,min,pts,reb,ast,tpm,stl,blk,to,fgm,fga,tpa,ftm,fta,pf,po
// (po = 1 for a playoff game, 0 for the regular season; the last five fields were added Nov 2026,
//  so readers treat a missing value as 0.)
// date is the US Eastern game date (YYYY-MM-DD), season the start year label ("2025-26"),
// ha "H" or "A", res "W" or "L", score "team-opp".
const fs = require('fs');
const path = require('path');

const SEASONS = [2025, 2026, 2027]; // ESPN labels a season by its end year: 2027 = 2026-27
const OUT = path.join(__dirname, '..', 'public', 'data', 'pgl.json');
// ESPN abbreviations that differ from the codes StatSniper uses.
const CODE = { GS: 'GSW', NO: 'NOP', NY: 'NYK', SA: 'SAS', UTAH: 'UTA', WSH: 'WAS' };
const code = (a) => CODE[a] || a;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'StatSniper/1.0' } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      if (i === tries - 1) throw new Error(url + ': ' + e.message);
      await sleep(500 * 2 ** i);
    }
  }
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

// Game dates come in UTC; NBA dates are US Eastern (a 7:30 pm ET tip is past midnight UTC).
const usDate = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const seasonLabel = (s) => `${s - 1}-${String(s).slice(2)}`;

async function playerGames(pid, teamIdToCode) {
  const games = [];
  for (const season of SEASONS) {
    const r = await getJson(`https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${pid}/gamelog?season=${season}`);
    if (!r || !r.events || !r.seasonTypes) continue;
    const idx = Object.fromEntries((r.names || []).map((n, i) => [n, i]));
    for (const st of r.seasonTypes) {
      if (/preseason/i.test(st.displayName || '')) continue;
      const po = /postseason|playoff|play-in/i.test(st.displayName || '') ? 1 : 0;
      for (const cat of st.categories || []) {
        for (const ev of cat.events || []) {
          const e = r.events[ev.eventId]; if (!e) continue;
          const s = ev.stats || [];
          const num = (k) => { const v = s[idx[k]]; return v == null || v === '' ? 0 : Number(v); };
          const pair = (k) => String(s[idx[k]] || '0-0').split('-').map(Number);
          const [fgm, fga] = pair('fieldGoalsMade-fieldGoalsAttempted');
          const [tpm, tpa] = pair('threePointFieldGoalsMade-threePointFieldGoalsAttempted');
          const [ftm, fta] = pair('freeThrowsMade-freeThrowsAttempted');
          const home = e.atVs === 'vs';
          const own = home ? e.homeTeamScore : e.awayTeamScore, opp = home ? e.awayTeamScore : e.homeTeamScore;
          const oppCode = code((e.opponent && e.opponent.abbreviation) || '?');
          const teamCode = teamIdToCode[home ? e.homeTeamId : e.awayTeamId] || '';
          games.push({
            date: usDate(e.gameDate), season: seasonLabel(season), team: teamCode, opp: oppCode,
            ha: home ? 'H' : 'A', res: e.gameResult || '', score: `${own}-${opp}`,
            min: num('minutes'), pts: num('points'), reb: num('totalRebounds'), ast: num('assists'), tpm,
            stl: num('steals'), blk: num('blocks'), to: num('turnovers'), fgm, fga, tpa, ftm, fta, pf: num('fouls'), po,
          });
        }
      }
    }
  }
  games.sort((a, b) => (a.date < b.date ? 1 : -1));
  return games;
}

(async () => {
  const t = await getJson('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams');
  const teams = t.sports[0].leagues[0].teams.map((x) => x.team);
  const teamIdToCode = Object.fromEntries(teams.map((x) => [x.id, code(x.abbreviation)]));
  const roster = [];
  await pool(teams, 6, async (tm) => {
    const r = await getJson(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${tm.id}/roster`);
    for (const a of (r && r.athletes) || []) {
      roster.push({ pid: a.id, player: a.fullName, team: code(tm.abbreviation), pos: (a.position && a.position.abbreviation) || '', jersey: a.jersey || '' });
    }
  });
  console.log(`${roster.length} players on ${teams.length} rosters; fetching game logs…`);
  let done = 0;
  const rows = await pool(roster, 10, async (p) => {
    let games = [];
    try { games = await playerGames(p.pid, teamIdToCode); } catch (e) { console.warn('skip', p.player, e.message); }
    if (++done % 50 === 0) console.log(`  ${done}/${roster.length}`);
    if (!games.length) return null;
    const g = games.map((x) => [x.date, x.season, x.team, x.opp, x.ha, x.res, x.score, x.min, x.pts, x.reb, x.ast, x.tpm, x.stl, x.blk, x.to, x.fgm, x.fga, x.tpa, x.ftm, x.fta, x.pf, x.po].join(',')).join(';');
    return { ...p, n: games.length, g };
  });
  const out = rows.filter(Boolean).sort((a, b) => a.player.localeCompare(b.player));
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`Wrote ${out.length} players to ${path.relative(process.cwd(), OUT)} (${(fs.statSync(OUT).size / 1024 / 1024).toFixed(2)} MB)`);
})().catch((e) => { console.error(e); process.exit(1); });
