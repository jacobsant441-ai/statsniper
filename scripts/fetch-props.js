// Australian bookmaker player prop prices (The Odds API, AU region) for NBA or NFL, one Sydney day (or the
// coming NFL week) at a time, so the credit cost is predictable. The account is charged 1 credit per game for
// each market that comes back with prices (markets a bookie doesn't post cost nothing).
// Checks the credits left first (the events list is free) and stops if this run could leave fewer than
// --keep (default 100). Writes public/data/props.json (private: never committed or published), keeping every
// line each player is offered at (best over / under price across AU books at each line).
//
// Usage: ODDS_API_KEY=… node scripts/fetch-props.js "Wed 11 Nov"                 NBA core: pts, reb, ast, threes
//        ODDS_API_KEY=… node scripts/fetch-props.js "Wed 11 Nov" --alt           + alternate lines (20+, 25+ …)
//        ODDS_API_KEY=… node scripts/fetch-props.js "Wed 11 Nov" --all           every NBA player market AU books post
//        ODDS_API_KEY=… node scripts/fetch-props.js week --sport=nfl --all       every NFL player market, next 8 days
//   [--games=MIL-NYK,ORL-SAC]  only these games (other games' saved lines for the day are kept)
//   [--keep=100]               credits to keep in reserve
//   [--stats=points,rebounds]  (core mode only) pick from points, rebounds, assists, threes
// The key is read from ODDS_API_KEY only (never written to a file). On the Mac the daily job reads it from the
// Keychain (scripts/odds-daily.sh).
const fs = require('fs');
const path = require('path');

const KEY = process.env.ODDS_API_KEY;
if (!KEY) { console.error('ODDS_API_KEY is not set (put it in front of the command; never in a file).'); process.exit(1); }
const DATA = path.join(__dirname, '..', 'public', 'data');
const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch (e) { return []; } };
const DAY = process.argv[2];
if (!DAY || DAY.startsWith('--')) { console.error('Usage: node scripts/fetch-props.js "<Sydney day>"|week [--sport=nba|nfl] [--all|--alt] [--games=ID,ID] [--keep=100]'); process.exit(1); }
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
const SPORT = arg('sport', 'nba');
const KEEP = Number(arg('keep', 100));
const ALL = process.argv.includes('--all');
const ALT = ALL || process.argv.includes('--alt');
const ONLY = arg('games', '').split(',').filter(Boolean);

// Market key -> our stat code. [key, stat, kind]: kind 'ou' has a base and an _alternate market, 'alt' only an
// alternate one, 'yes' is a yes/no market (no line; stored as line 0.5, Yes = over). All seen at AU books (Nov 2026).
const MARKETS = {
  nba: [
    ['player_points', 'PTS', 'ou'], ['player_rebounds', 'REB', 'ou'], ['player_assists', 'AST', 'ou'], ['player_threes', '3PM', 'ou'],
    ['player_steals', 'STL', 'ou'], ['player_blocks', 'BLK', 'ou'], ['player_blocks_steals', 'SB', 'ou'], ['player_turnovers', 'TOV', 'ou'],
    ['player_points_rebounds_assists', 'PRA', 'ou'], ['player_points_rebounds', 'PR', 'ou'], ['player_points_assists', 'PA', 'ou'], ['player_rebounds_assists', 'RA', 'ou'],
    ['player_twos', '2PM', 'alt'],
    ['player_double_double', 'DD', 'yes'], ['player_triple_double', 'TD', 'yes'], ['player_first_basket', 'FB', 'yes'],
  ],
  nfl: [
    ['player_pass_yds', 'PYD', 'ou'], ['player_pass_tds', 'PTD', 'ou'], ['player_pass_completions', 'CMP', 'ou'], ['player_pass_attempts', 'PATT', 'ou'],
    ['player_pass_interceptions', 'INT', 'ou'], ['player_pass_longest_completion', 'PLONG', 'ou'], ['player_pass_rush_yds', 'PRYD', 'ou'],
    ['player_rush_yds', 'RYD', 'ou'], ['player_rush_attempts', 'RATT', 'ou'], ['player_rush_longest', 'RLONG', 'alt'], ['player_rush_tds', 'RTD', 'alt'],
    ['player_reception_yds', 'RECYD', 'ou'], ['player_receptions', 'REC', 'ou'], ['player_reception_longest', 'RECLONG', 'ou'],
    ['player_rush_reception_yds', 'RRYD', 'ou'], ['player_defensive_interceptions', 'DINT', 'alt'],
    ['player_anytime_td', 'ATD', 'yes'], ['player_1st_td', 'FTD', 'yes'], ['player_last_td', 'LTD', 'yes'], ['player_tds_over', 'TDS', 'ou1'],
  ],
};
if (!MARKETS[SPORT]) { console.error('Unknown --sport (nba or nfl)'); process.exit(1); }
const CORE = { points: 'PTS', rebounds: 'REB', assists: 'AST', threes: '3PM' };
const coreStats = arg('stats', 'points,rebounds,assists,threes').split(',').map((s) => CORE[s]).filter(Boolean);
const list = ALL ? MARKETS[SPORT] : MARKETS[SPORT].filter(([, st]) => coreStats.includes(st));
if (!list.length) { console.error('No markets chosen (use --all for NFL).'); process.exit(1); }
const MKEYS = list.flatMap(([k, , kind]) => (kind === 'ou' ? (ALT ? [k, k + '_alternate'] : [k]) : kind === 'alt' ? [k + '_alternate'] : [k]));
const statOf = (key) => { const x = list.find(([k]) => key === k || key === k + '_alternate'); return x ? x[1] : null; };

const API = 'https://api.the-odds-api.com/v4/sports/' + (SPORT === 'nfl' ? 'americanfootball_nfl' : 'basketball_nba') + '/';
const sydDay = (iso) => new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso)).replace(',', '');
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const NFL = { 'Arizona Cardinals': 'ARI', 'Atlanta Falcons': 'ATL', 'Baltimore Ravens': 'BAL', 'Buffalo Bills': 'BUF', 'Carolina Panthers': 'CAR', 'Chicago Bears': 'CHI', 'Cincinnati Bengals': 'CIN', 'Cleveland Browns': 'CLE', 'Dallas Cowboys': 'DAL', 'Denver Broncos': 'DEN', 'Detroit Lions': 'DET', 'Green Bay Packers': 'GB', 'Houston Texans': 'HOU', 'Indianapolis Colts': 'IND', 'Jacksonville Jaguars': 'JAC', 'Kansas City Chiefs': 'KC', 'Los Angeles Rams': 'LA', 'Los Angeles Chargers': 'LAC', 'Las Vegas Raiders': 'LV', 'Miami Dolphins': 'MIA', 'Minnesota Vikings': 'MIN', 'New England Patriots': 'NE', 'New Orleans Saints': 'NO', 'New York Giants': 'NYG', 'New York Jets': 'NYJ', 'Philadelphia Eagles': 'PHI', 'Pittsburgh Steelers': 'PIT', 'Seattle Seahawks': 'SEA', 'San Francisco 49ers': 'SF', 'Tampa Bay Buccaneers': 'TB', 'Tennessee Titans': 'TEN', 'Washington Commanders': 'WAS' };

(async () => {
  const r = await fetch(`${API}events?apiKey=${KEY}`); // free
  if (!r.ok) { console.error('events list failed: HTTP ' + r.status); process.exit(1); }
  const left = Number(r.headers.get('x-requests-remaining'));
  const now = Date.now();
  const evs = (await r.json()).filter((e) => new Date(e.commence_time).getTime() > now && (DAY === 'week' ? new Date(e.commence_time).getTime() < now + 8 * 86400000 : sydDay(e.commence_time) === DAY));
  let matched;
  if (SPORT === 'nba') {
    const games = read('games.json').filter((g) => (DAY === 'week' || g.date === DAY) && (!ONLY.length || ONLY.includes(g.id)));
    if (!games.length) { console.error('No NBA games for ' + DAY + ' in games.json'); process.exit(1); }
    matched = games.map((g) => { const [an, hn] = String(g.matchup || '').split(' @ '); const e = evs.find((x) => norm(x.home_team).includes(norm(hn).split(' ').pop()) && norm(x.away_team).includes(norm(an).split(' ').pop())); return e ? { id: g.id, day: g.date, e } : null; }).filter(Boolean);
  } else {
    matched = evs.map((e) => ({ id: (NFL[e.away_team] || '?') + '-' + (NFL[e.home_team] || '?'), day: sydDay(e.commence_time), e })).filter((x) => !ONLY.length || ONLY.includes(x.id));
  }
  const cost = matched.length * MKEYS.length;
  console.log(`${SPORT.toUpperCase()} ${DAY}: ${matched.length} games at the bookies, ${MKEYS.length} markets each. At most ${cost} credits (only markets with prices are charged); ${left} left now.`);
  if (!matched.length) return;
  if (Number.isFinite(left) && left - cost < KEEP) { console.error(`Stopped: this could leave ${left - cost}, under the ${KEEP} kept in reserve. Use fewer markets, --games, or a lower --keep.`); process.exit(1); }
  const markets = MKEYS.join(',');
  const out = []; let after = left;
  for (const { id, day, e } of matched) {
    const pr = await fetch(`${API}events/${e.id}/odds?apiKey=${KEY}&regions=au&markets=${markets}&oddsFormat=decimal`);
    const was = after; after = Number(pr.headers.get('x-requests-remaining')) || after;
    if (!pr.ok) { console.warn(id + ': HTTP ' + pr.status + ' ' + (await pr.text()).slice(0, 200)); continue; }
    const j = await pr.json(); const by = {};
    for (const b of j.bookmakers || []) for (const m of b.markets || []) {
      const st = statOf(m.key); if (!st) continue;
      for (const o of m.outcomes || []) {
        const nm = String(o.name || '');
        const isSide = /^(over|under|yes|no)$/i.test(nm);
        const player = o.description || (!isSide ? nm : ''); if (!player) continue;
        const line = o.point != null ? Number(o.point) : 0.5;
        const side = /^(under|no)$/i.test(nm) ? 'under' : 'over';
        const k = player + '|' + st + '|' + line;
        const x = (by[k] = by[k] || { player, stat: st, line, books: new Set(), alt: true });
        if (!m.key.endsWith('_alternate')) x.alt = false;
        x.books.add(b.title);
        if (!x[side] || o.price > x[side]) { x[side] = o.price; x[side + '_book'] = b.title; }
      }
    }
    const rows = Object.values(by).map((x) => ({ sp: SPORT, game: id, day, player: x.player, stat: x.stat, line: x.line, main: !x.alt, over: x.over || null, over_book: x.over_book || '', under: x.under || null, under_book: x.under_book || '', books: x.books.size, kick: e.commence_time }));
    out.push(...rows);
    const stats = [...new Set(rows.map((x) => x.stat))];
    console.log(`  ${id} (${day}): ${rows.length} lines, ${stats.length} stats [${stats.join(' ')}], ${Number.isFinite(was - after) ? was - after : '?'} credits`);
  }
  const done = new Set(matched.map((x) => x.id + '|' + x.day));
  const days = new Set(matched.map((x) => x.day));
  // keep other sports, other days, and (with --games) other games of the same day; drop past days
  const today = sydDay(new Date().toISOString());
  const keep = read('props.json').filter((q) => q.day && ((q.sp || 'nba') !== SPORT || !days.has(q.day) || (ONLY.length && !done.has(q.game + '|' + q.day))) && (!q.kick || new Date(q.kick).getTime() > now - 2 * 86400000 || q.day === today));
  fs.writeFileSync(path.join(DATA, 'props.json'), JSON.stringify(keep.concat(out)));
  console.log(`props.json: ${out.length} ${SPORT.toUpperCase()} lines saved. Credits left: ${after}.`);
})().catch((e) => { console.error(e); process.exit(1); });
