// Builds team profiles for StatSniper's team pages: every NBA and NFL team and every
// Premier League, La Liga and Champions League club, from ESPN's public feed.
// Usage: npm run fetch:teams   (run after fetch-gamelogs, fetch-athletes and fetch-ucl so the
//                               key players and Champions League clubs are current)
//
// Writes public/data/tprof.json, one row per team:
//   {sp: 'nba'|'nfl'|'fb', code, id, name, short, league, color, alt, record, standing,
//    group, n_group, off_rank, def_rank, for_pg, against_pg,
//    stats: [{k, label, v, rank, better}], home, away, form,
//    games: [[isoDate, comp, oppCode, oppName, 'H'|'A', 'W'|'L'|'D', for, against]] newest first,
//    upcoming: [[isoDate, comp, oppCode, oppName, 'H'|'A']] next five,
//    players: [{id, name, pos, line}] key players for links to their pages}
// Ranks are 1 = best within the team's group (the NBA, the NFL, the Premier League,
// La Liga, or the other Champions League clubs).
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'public', 'data');
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/';
const NBA_CODE = { GS: 'GSW', NO: 'NOP', NY: 'NYK', SA: 'SAS', UTAH: 'UTA', WSH: 'WAS' };
const NFL_CODE = { JAX: 'JAC', LAR: 'LA', WSH: 'WAS' };
const SOC_CODE = { BHA: 'BRI', CHE: 'CFC', LIV: 'LFC', MNC: 'MCI', MAN: 'MUN', CEL: 'RCC', RAY: 'RVC', BET: 'RBB', VAL: 'VCF' };

const read = (f, d = []) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch (e) { return d; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url, { headers: { 'User-Agent': 'StatSniper/1.0' } }); if (r.status === 404) return null; if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } catch (e) { if (i === tries - 1) { console.warn('failed', url, e.message); return null; } await sleep(600 * 2 ** i); }
  }
}
async function pool(items, n, fn) { const out = new Array(items.length); let next = 0; await Promise.all(Array.from({ length: n }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } })); return out; }
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const pct = (n, d) => (d ? Math.round((100 * n) / d) : null);
const scoreOf = (x) => Number(x && typeof x.score === 'object' ? x.score.value : x && x.score);

// Completed and upcoming games from one team schedule response.
function parseSchedule(r, id, comp, codeOf) {
  const done = [], next = [];
  for (const ev of (r && r.events) || []) {
    const c = ev.competitions && ev.competitions[0]; if (!c) continue;
    const me = c.competitors.find((x) => x.team && x.team.id === String(id)), op = c.competitors.find((x) => x !== me);
    if (!me || !op) continue;
    const ha = me.homeAway === 'home' ? 'H' : 'A', label = comp || (ev.league && ev.league.abbreviation) || '';
    const st = c.status && c.status.type;
    if (st && st.completed) {
      const f = scoreOf(me), a = scoreOf(op); if (!Number.isFinite(f) || !Number.isFinite(a)) continue;
      done.push([ev.date, label, codeOf(op.team), op.team.displayName, ha, f > a ? 'W' : f < a ? 'L' : 'D', f, a]);
    } else if (st && st.state === 'pre') next.push([ev.date, label, codeOf(op.team), op.team.displayName, ha]);
  }
  return { done, next };
}
function splits(games) {
  const rec = (gs) => { const w = gs.filter((g) => g[5] === 'W').length, d = gs.filter((g) => g[5] === 'D').length; return { w, d, l: gs.length - w - d, n: gs.length, for_pg: gs.length ? r1(gs.reduce((s, g) => s + g[6], 0) / gs.length) : null, against_pg: gs.length ? r1(gs.reduce((s, g) => s + g[7], 0) / gs.length) : null }; };
  return { all: rec(games), home: rec(games.filter((g) => g[4] === 'H')), away: rec(games.filter((g) => g[4] === 'A')), form: games.slice(0, 5).map((g) => g[5]).join('') };
}
// Rank each stat within the group: 1 = best.
function rankGroup(rows) {
  const keys = new Set(rows.flatMap((r) => r.stats.map((s) => s.k)));
  for (const k of keys) {
    const vals = rows.map((r) => r.stats.find((s) => s.k === k)).filter((s) => s && Number.isFinite(s.v));
    vals.sort((a, b) => (a.better === 'low' ? a.v - b.v : b.v - a.v));
    vals.forEach((s, i) => { s.rank = i > 0 && vals[i - 1].v === s.v ? vals[i - 1].rank : i + 1; });
  }
  const ordered = (f, low) => rows.filter((r) => Number.isFinite(r[f])).sort((a, b) => (low ? a[f] - b[f] : b[f] - a[f]));
  ordered('for_pg').forEach((r, i) => { r.off_rank = i + 1; });
  ordered('against_pg', true).forEach((r, i) => { r.def_rank = i + 1; });
  rows.forEach((r) => { r.n_group = rows.length; });
}
const teamBase = (t, info, sp, code, league, group) => ({
  sp, code, id: t.id, name: t.displayName, short: t.shortDisplayName || t.name || t.displayName, league, group,
  color: '#' + ((info && info.color) || t.color || '333333'), alt: '#' + ((info && info.alternateColor) || t.alternateColor || 'ffffff'),
  record: (info && info.record && info.record.items && info.record.items[0] && info.record.items[0].summary) || '',
  standing: (info && info.standingSummary) || '',
});

// ESPN team statistics: pick stats by "category.name".
function espnStats(r, spec) {
  const cats = (r && r.results && r.results.stats && r.results.stats.categories) || [];
  const get = (cat, name) => { const c = cats.find((x) => x.name === cat); const s = c && c.stats.find((x) => x.name === name); return s ? Number(String(s.value ?? s.displayValue).replace(/,/g, '')) : null; };
  return spec.map(([cat, name, label, better, dp = 1]) => { const v = get(cat, name); return { k: cat + '.' + name, label, v: v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** dp) / 10 ** dp, better }; });
}
const NBA_SPEC = [['offensive', 'avgPoints', 'Points', 'high'], ['offensive', 'fieldGoalPct', 'Field goal %', 'high'], ['offensive', 'threePointPct', '3-point %', 'high'], ['offensive', 'freeThrowPct', 'Free throw %', 'high'], ['general', 'avgRebounds', 'Rebounds', 'high'], ['offensive', 'avgAssists', 'Assists', 'high'], ['defensive', 'avgSteals', 'Steals', 'high'], ['defensive', 'avgBlocks', 'Blocks', 'high'], ['offensive', 'avgTurnovers', 'Turnovers', 'low']];
const NFL_SPEC = [['scoring', 'totalPointsPerGame', 'Points', 'high'], ['passing', 'yardsPerGame', 'Yards', 'high'], ['passing', 'passingYardsPerGame', 'Passing yards', 'high'], ['rushing', 'rushingYardsPerGame', 'Rushing yards', 'high'], ['miscellaneous', 'thirdDownConvPct', '3rd down %', 'high'], ['miscellaneous', 'redzoneTouchdownPct', 'Red zone TD %', 'high'], ['miscellaneous', 'turnOverDifferential', 'Turnover margin', 'high', 0], ['defensive', 'sacks', 'Sacks', 'high', 0], ['defensiveInterceptions', 'interceptions', 'Interceptions', 'high', 0]];

async function usSport(sp, slug, codeMap, league, spec) {
  const t = await getJson(`${SITE}${slug}/teams`);
  const teams = t.sports[0].leagues[0].teams.map((x) => x.team);
  const codeOf = (tm) => codeMap[tm.abbreviation] || tm.abbreviation;
  const rows = await pool(teams, 6, async (tm) => {
    const [info, stats, sched] = await Promise.all([getJson(`${SITE}${slug}/teams/${tm.id}`), getJson(`${SITE}${slug}/teams/${tm.id}/statistics`), getJson(`${SITE}${slug}/teams/${tm.id}/schedule`)]);
    const { done, next } = parseSchedule(sched, tm.id, '', codeOf);
    done.sort((a, b) => (a[0] < b[0] ? 1 : -1)); next.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const sp2 = splits(done);
    const row = { ...teamBase(tm, info && info.team, sp, codeOf(tm), league, league), stats: espnStats(stats, spec), games: done, upcoming: next.slice(0, 5) };
    row.for_pg = sp2.all.for_pg; row.against_pg = sp2.all.against_pg; row.home = sp2.home; row.away = sp2.away; row.form = sp2.form;
    row.stats.push({ k: 'allowed', label: 'Points allowed', v: sp2.all.against_pg, better: 'low' }, { k: 'net', label: 'Point differential', v: sp2.all.for_pg != null ? r1(sp2.all.for_pg - sp2.all.against_pg) : null, better: 'high' });
    if (!row.record && sp2.all.n) row.record = `${sp2.all.w}-${sp2.all.l}`;
    return row;
  });
  rankGroup(rows);
  return rows;
}

async function football() {
  const ucl = read('ucl_teams.json'), table = read('table.json');
  const byId = new Map(ucl.map((u) => [u.id, u]));
  const codeOf = (tm) => (byId.get(tm.id) ? byId.get(tm.id).code : SOC_CODE[tm.abbreviation] || tm.abbreviation);
  const clubs = [];
  for (const [slug, league] of [['eng.1', 'Premier League'], ['esp.1', 'La Liga']]) {
    const r = await getJson(`${SITE}soccer/${slug}/teams`);
    r.sports[0].leagues[0].teams.forEach((x) => clubs.push({ tm: x.team, lg: slug, league, group: league }));
  }
  ucl.filter((u) => !u.domestic).forEach((u) => clubs.push({ tm: { id: u.id, abbreviation: u.code, displayName: u.name }, lg: u.lg === 'uefa.champions' ? null : u.lg, league: 'Champions League', group: 'Champions League clubs' }));
  const rows = await pool(clubs, 6, async ({ tm, lg, league, group }) => {
    const info = (await getJson(`${SITE}soccer/${lg || 'uefa.champions'}/teams/${tm.id}`)) || {};
    const t = info.team || tm;
    const inUcl = byId.has(tm.id);
    const done = [], next = [];
    for (const [s, comp] of [[lg, null], [inUcl ? 'uefa.champions' : null, 'Champions League']]) {
      if (!s) continue;
      for (const fx of ['', '?fixture=true']) {
        const p = parseSchedule(await getJson(`${SITE}soccer/${s}/teams/${tm.id}/schedule${fx}`), tm.id, comp, codeOf);
        done.push(...p.done); next.push(...p.next);
      }
    }
    const uniq = (list) => [...new Map(list.map((g) => [g[0] + g[2], g])).values()];
    const games = uniq(done).sort((a, b) => (a[0] < b[0] ? 1 : -1)), upcoming = uniq(next).sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const code = codeOf(tm);
    const tbl = table.find((q) => q.abbr === code && (q.league === league || league === 'Champions League'));
    const row = { ...teamBase(t, info.team, 'fb', code, league, group), games, upcoming: upcoming.slice(0, 5) };
    if (tbl) { row.name = tbl.team; }
    const s = splits(games), n = games.length || 1;
    row.for_pg = r2(games.reduce((x, g) => x + g[6], 0) / n); row.against_pg = r2(games.reduce((x, g) => x + g[7], 0) / n);
    row.home = s.home; row.away = s.away; row.form = s.form;
    const domestic = table.find((q) => q.abbr === code && q.league !== 'Champions League'), cl = table.find((q) => q.abbr === code && q.league === 'Champions League');
    row.record = `${s.all.w}W ${s.all.d}D ${s.all.l}L`;
    row.standing = [domestic ? `${domestic.rank}${['th', 'st', 'nd', 'rd'][domestic.rank % 10 < 4 && Math.floor(domestic.rank / 10) !== 1 ? domestic.rank % 10 : 0]} in the ${domestic.league}` : row.standing, cl ? `${cl.rank}${['th', 'st', 'nd', 'rd'][cl.rank % 10 < 4 && Math.floor(cl.rank / 10) !== 1 ? cl.rank % 10 : 0]} in the Champions League` : ''].filter(Boolean).join(' · ');
    row.stats = [
      { k: 'gf', label: 'Goals scored', v: row.for_pg, better: 'high' }, { k: 'ga', label: 'Goals conceded', v: row.against_pg, better: 'low' },
      { k: 'ppg', label: 'Points per game', v: r2(games.reduce((x, g) => x + (g[5] === 'W' ? 3 : g[5] === 'D' ? 1 : 0), 0) / n), better: 'high' },
      { k: 'cs', label: 'Clean sheet %', v: pct(games.filter((g) => !g[7]).length, games.length), better: 'high' },
      { k: 'fts', label: 'Failed to score %', v: pct(games.filter((g) => !g[6]).length, games.length), better: 'low' },
      { k: 'btts', label: 'Both teams scored %', v: pct(games.filter((g) => g[6] && g[7]).length, games.length), better: 'none' },
      { k: 'o25', label: 'Over 2.5 goals %', v: pct(games.filter((g) => g[6] + g[7] > 2).length, games.length), better: 'none' },
    ];
    return row;
  });
  for (const g of [...new Set(rows.map((r) => r.group))]) rankGroup(rows.filter((r) => r.group === g));
  return rows;
}

// Key players from the player files already on disk.
function keyPlayers(rows) {
  const pgl = read('pgl.json'), nflp = read('nflp.json'), socp = read('socp.json');
  const games = (r) => String(r.g || '').split(';').filter(Boolean).map((s) => s.split(','));
  for (const t of rows) {
    if (t.sp === 'nba') {
      t.players = pgl.filter((p) => p.team === t.code).map((p) => { const g = games(p).filter((x) => x[1] === '2026-27' && Number(x[7]) > 0); const av = (i) => g.reduce((s, x) => s + Number(x[i]), 0) / (g.length || 1); return { id: p.pid, name: p.player, pos: p.pos, n: g.length, key: av(8), line: g.length ? `${r1(av(8))} pts · ${r1(av(9))} reb · ${r1(av(10))} ast` : '' }; })
        .filter((p) => p.n >= 2).sort((a, b) => b.key - a.key).slice(0, 5).map(({ key, n, ...p }) => p);
    } else {
      const src = t.sp === 'nfl' ? nflp : socp, season = t.sp === 'nfl' ? '2026' : '2026-27';
      const leaders = t.sp === 'nfl' ? [['passingYards', 'pass yds'], ['rushingYards', 'rush yds'], ['receivingYards', 'rec yds'], ['totalTackles', 'tackles'], ['sacks', 'sacks']] : [['totalGoals', 'goals'], ['goalAssists', 'assists'], ['saves', 'saves']];
      const mine = src.filter((p) => p.team === t.code).map((p) => { const cols = String(p.cols).split(','); const g = games(p).filter((x) => x[1] === season); const tot = (c) => { const i = cols.indexOf(c); return i < 0 ? 0 : g.reduce((s, x) => s + (Number(x[7 + i]) || 0), 0); }; return { p, n: g.length, tot }; });
      const out = [], used = new Set();
      for (const [c, label] of leaders) {
        const best = mine.filter((m) => !used.has(m.p.pid)).sort((a, b) => b.tot(c) - a.tot(c))[0];
        if (best && best.tot(c) > 0) { used.add(best.p.pid); const v = Math.round(best.tot(c) * 10) / 10; out.push({ id: best.p.pid, name: best.p.player, pos: best.p.pos, line: `${v} ${v === 1 ? label.replace(/s$/, '') : label} in ${best.n} game${best.n === 1 ? '' : 's'}` }); }
      }
      if (t.sp === 'fb') mine.filter((m) => !used.has(m.p.pid)).sort((a, b) => (b.tot('totalGoals') + b.tot('goalAssists')) - (a.tot('totalGoals') + a.tot('goalAssists'))).slice(0, Math.max(0, 4 - out.length)).forEach((m) => { if (m.tot('totalGoals') + m.tot('goalAssists') > 0) out.push({ id: m.p.pid, name: m.p.player, pos: m.p.pos, line: `${m.tot('totalGoals')} goal${m.tot('totalGoals') === 1 ? '' : 's'} · ${m.tot('goalAssists')} assist${m.tot('goalAssists') === 1 ? '' : 's'} in ${m.n} games` }); });
      t.players = out;
    }
  }
}

(async () => {
  const nba = await usSport('nba', 'basketball/nba', NBA_CODE, 'NBA', NBA_SPEC);
  console.log(`NBA: ${nba.length} teams`);
  const nfl = await usSport('nfl', 'football/nfl', NFL_CODE, 'NFL', NFL_SPEC);
  console.log(`NFL: ${nfl.length} teams`);
  const fb = await football();
  console.log(`Football: ${fb.length} clubs`);
  const rows = [...nba, ...nfl, ...fb];
  keyPlayers(rows);
  fs.writeFileSync(path.join(DATA, 'tprof.json'), JSON.stringify(rows));
  console.log(`Wrote ${rows.length} teams to data/tprof.json (${(fs.statSync(path.join(DATA, 'tprof.json')).size / 1024).toFixed(0)} KB)`);
})().catch((e) => { console.error(e); process.exit(1); });
