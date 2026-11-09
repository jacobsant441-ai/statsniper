// NBA box scores for one slate from ESPN (Run 2 step 2): adds/replaces rows in public/data/boxes.json
// (team totals and player lines, the shape Review and the game pages read) and rebuilds
// public/data/pact.json (every player in those games: game, team, player, pts, reb, ast, tpm), which
// grade-bets.js uses for player props.
// Usage: node scripts/fetch-boxes.js 20261104      (the US date of the games; Sydney is the next day)
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'public', 'data');
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/';
const CODE = { GS: 'GSW', NO: 'NOP', NY: 'NYK', SA: 'SAS', UTAH: 'UTA', WSH: 'WAS' };
const US = process.argv[2];
if (!/^\d{8}$/.test(US || '')) { console.error('Usage: node scripts/fetch-boxes.js YYYYMMDD (US date)'); process.exit(1); }
const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch (e) { return []; } };
const write = (f, d) => fs.writeFileSync(path.join(DATA, f), JSON.stringify(d));
async function getJson(url) {
  for (let i = 0; i < 4; i++) {
    try { const r = await fetch(url, { headers: { 'User-Agent': 'StatSniper/1.0' } }); if (r.ok) return await r.json(); } catch (e) { /* retry */ }
    await new Promise((res) => setTimeout(res, 500 * (i + 1)));
  }
  throw new Error('failed: ' + url);
}
const sydKey = (iso) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', weekday: 'short', day: 'numeric', month: 'short' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value])); return `${p.weekday} ${p.day} ${p.month}`; };
const code = (a) => CODE[a] || a;
const pair = (s) => String(s || '0-0').split('-').map(Number);

(async () => {
  const sb = await getJson(`${SITE}scoreboard?dates=${US}`);
  const boxes = read('boxes.json'), pact = [];
  let added = 0, bad = 0;
  for (const ev of sb.events || []) {
    const c = ev.competitions[0]; if (!c.status.type.completed) continue;
    const H = c.competitors.find((x) => x.homeAway === 'home'), A = c.competitors.find((x) => x.homeAway === 'away');
    const hc = code(H.team.abbreviation), ac = code(A.team.abbreviation), id = `${ac}-${hc}`, date = sydKey(ev.date);
    const s = await getJson(`${SITE}summary?event=${ev.id}`);
    const teamTot = (abbr) => {
      const t = (s.boxscore.teams || []).find((x) => x.team.abbreviation === abbr); const st = Object.fromEntries((t ? t.statistics : []).map((x) => [x.name, x.displayValue]));
      const [fgm, fga] = pair(st['fieldGoalsMade-fieldGoalsAttempted']), [tpm, tpa] = pair(st['threePointFieldGoalsMade-threePointFieldGoalsAttempted']), [ftm, fta] = pair(st['freeThrowsMade-freeThrowsAttempted']);
      const n = (k) => (st[k] != null ? Number(st[k]) : null);
      const orb = n('offensiveRebounds'), tov = n('totalTurnovers') ?? n('turnovers');
      return { fgm, fga, tpm, tpa, ftm, fta, orb, drb: n('defensiveRebounds'), ast: n('assists'), stl: n('steals'), blk: n('blocks'), tov, pf: n('fouls'), paint: n('pointsInPaint'), fb: n('fastBreakPoints'), sc: null, pot: n('turnoverPoints'), bench: null, poss: Math.round(fga - orb + tov + 0.44 * fta) };
    };
    const players = (abbr, team) => {
      const tp = (s.boxscore.players || []).find((x) => x.team.abbreviation === abbr); if (!tp) return [];
      const g = tp.statistics[0], k = g.keys || [];
      return (g.athletes || []).filter((a) => !a.didNotPlay && a.stats && a.stats.length).map((a) => {
        const v = Object.fromEntries(k.map((key, i) => [key, a.stats[i]]));
        const [fgm, fga] = pair(v['fieldGoalsMade-fieldGoalsAttempted']), [tpm, tpa] = pair(v['threePointFieldGoalsMade-threePointFieldGoalsAttempted']), [ftm, fta] = pair(v['freeThrowsMade-freeThrowsAttempted']);
        const row = { name: a.athlete.displayName, pos: (a.athlete.position && a.athlete.position.abbreviation) || '', min: Number(v.minutes) || 0, pts: Number(v.points) || 0, reb: Number(v.rebounds) || 0, ast: Number(v.assists) || 0, fgm, fga, tpm, tpa, ftm, fta, tov: Number(v.turnovers) || 0, stl: Number(v.steals) || 0, blk: Number(v.blocks) || 0, pf: Number(v.fouls) || 0, starter: !!a.starter };
        if (row.fgm * 2 + row.tpm + row.ftm !== row.pts) bad++;
        pact.push({ game: id, team, player: row.name, pts: row.pts, reb: row.reb, ast: row.ast, tpm: row.tpm });
        return row;
      });
    };
    const ap = players(A.team.abbreviation, ac), hp = players(H.team.abbreviation, hc);
    const at = teamTot(A.team.abbreviation), ht = teamTot(H.team.abbreviation);
    at.bench = ap.filter((p) => !p.starter).reduce((t, p) => t + p.pts, 0); ht.bench = hp.filter((p) => !p.starter).reduce((t, p) => t + p.pts, 0);
    const row = { id, date, status: 'Final', away: ac, home: hc, away_name: A.team.name, home_name: H.team.name, away_pts: Number(A.score), home_pts: Number(H.score), away_team: at, home_team: ht,
      away_players: ap.map(({ starter, ...p }) => p), home_players: hp.map(({ starter, ...p }) => p), note: 'ESPN box score (final). Second-chance points are not in the feed; bench points are the non-starters; possessions are estimated.', sport: 'nba' };
    const i = boxes.findIndex((b) => b.id === id && b.date === date); if (i >= 0) boxes[i] = row; else boxes.push(row);
    added++;
  }
  write('boxes.json', boxes); write('pact.json', pact);
  console.log(`boxes: ${added} final games for US ${US} (${boxes.length} rows on file); pact: ${pact.length} player lines; ${bad} lines where FG*2+3PM+FTM != points`);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
