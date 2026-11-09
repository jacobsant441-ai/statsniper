// Fetches NFL and football (Premier League, La Liga) player game logs and each team's
// upcoming games from ESPN's public feed.
// Usage: npm run fetch:athletes
// Writes public/data/nflp.json, public/data/socp.json and public/data/tsched.json.
//
// nflp / socp: one row per player. `cols` names the stats in each game entry (they vary by
// position in the NFL); `g` lists games newest first, ";"-separated, each as
//   date,season,team,opp,ha,res,score,<one value per col>
// tsched: one row per upcoming team game: {sp, team, opp, ha, iso, comp}.
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'public', 'data');
const API = 'https://site.web.api.espn.com/apis/common/v3/sports/';
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/';
// ESPN abbreviations that differ from StatSniper's team codes.
const NFL_CODE = { JAX: 'JAC', LAR: 'LA', WSH: 'WAS' };
const SOC_CODE = { BHA: 'BRI', CHE: 'CFC', LIV: 'LFC', MNC: 'MCI', MAN: 'MUN', CEL: 'RCC', RAY: 'RVC', BET: 'RBB', VAL: 'VCF' };
// Offensive linemen and long snappers have no box score stats worth a page.
const NFL_SKIP = new Set(['C', 'G', 'OT', 'T', 'OL', 'LS']);

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
      await sleep(600 * 2 ** i);
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
const usDate = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const ukDate = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

// One player's games across seasons, with the union of stat names as columns.
async function gameLog(reqs, code, dateFn, seasonLabel, idToCode) {
  const games = [], cols = [];
  const seen = new Set();
  for (const { season, url } of reqs) {
    const r = await getJson(url).catch(() => null);
    if (!r || !r.events || !r.seasonTypes) continue;
    const names = r.names || [];
    names.forEach((n) => { if (!cols.includes(n)) cols.push(n); });
    for (const st of r.seasonTypes) {
      if (/preseason/i.test(st.displayName || '')) continue;
      for (const cat of st.categories || []) {
        for (const ev of cat.events || []) {
          if (seen.has(ev.eventId)) continue; seen.add(ev.eventId);
          const e = r.events[ev.eventId]; if (!e || !e.gameResult) continue;
          const home = e.atVs === 'vs';
          const own = home ? e.homeTeamScore : e.awayTeamScore, opp = home ? e.awayTeamScore : e.homeTeamScore;
          const vals = {}; names.forEach((n, i) => { const raw = String((ev.stats || [])[i] ?? '').replace(/[,;]/g, ''); const v = Number(raw); vals[n] = raw === '' ? '' : Number.isFinite(v) ? v : raw; }); // made-attempted pairs such as 2-3 stay as text
          games.push({ date: dateFn(e.gameDate), season: seasonLabel(season), team: (e.team && idToCode[e.team.id]) ? idToCode[e.team.id] : (e.team && e.team.abbreviation) ? code(e.team.abbreviation) : (idToCode[home ? e.homeTeamId : e.awayTeamId] || ''), opp: (e.opponent && idToCode[e.opponent.id]) || code((e.opponent && e.opponent.abbreviation) || '?'), ha: home ? 'H' : 'A', res: e.gameResult, score: `${own}-${opp}`, vals });
        }
      }
    }
  }
  games.sort((a, b) => (a.date < b.date ? 1 : -1));
  return { cols, g: games.map((x) => [x.date, x.season, x.team, x.opp, x.ha, x.res, x.score, ...cols.map((c) => x.vals[c] ?? '')].join(',')).join(';'), n: games.length };
}

async function teamSchedule(sp, league, id, teamCode, code, idToCode = {}) {
  const r = await getJson(`${SITE}${league}/teams/${id}/schedule` + (sp === 'soc' ? '?fixture=true' : '')).catch(() => null);
  const out = [];
  for (const ev of (r && r.events) || []) {
    const c = ev.competitions && ev.competitions[0]; if (!c) continue;
    if (c.status && c.status.type && c.status.type.state !== 'pre') continue;
    const me = c.competitors.find((x) => x.team && x.team.id === String(id)), op = c.competitors.find((x) => x !== me);
    if (!me || !op) continue;
    out.push({ sp, team: teamCode, opp: idToCode[op.team.id] || code(op.team.abbreviation), oppName: op.team.displayName, ha: me.homeAway === 'home' ? 'H' : 'A', iso: ev.date, comp: (ev.league && ev.league.abbreviation) || (ev.seasonType && ev.seasonType.name) || '' });
  }
  return out;
}

async function sport(cfg) {
  const t = await getJson(`${SITE}${cfg.league[0]}/teams`);
  const teams = [];
  for (const lg of cfg.league) {
    const r = lg === cfg.league[0] ? t : await getJson(`${SITE}${lg}/teams`);
    r.sports[0].leagues[0].teams.forEach((x) => teams.push({ ...x.team, lg }));
  }
  (cfg.extraTeams || []).forEach((x) => { if (!teams.some((t) => t.id === x.id)) teams.push(x); });
  const idToCode = { ...Object.fromEntries(teams.map((x) => [x.id, x.code || cfg.code(x.abbreviation)])), ...(cfg.codeById || {}) };
  const roster = [], sched = [];
  await pool(teams, 6, async (tm) => {
    const code = idToCode[tm.id];
    const r = await getJson(`${SITE}${tm.lg}/teams/${tm.id}/roster`);
    const list = cfg.flatten(r);
    for (const a of list) {
      const pos = (a.position && a.position.abbreviation) || '';
      if (cfg.skip && cfg.skip.has(pos)) continue;
      const pl = { pid: a.id, player: a.fullName || a.displayName, team: code, lg: tm.lg, pos, jersey: a.jersey || '', age: a.age || '', height: a.displayHeight || '', weight: a.displayWeight || '', status: (a.injuries && a.injuries[0] && a.injuries[0].status) || '' };
      if (cfg.tagPlayer) cfg.tagPlayer(pl, tm);
      roster.push(pl);
    }
    if (!tm.lg.endsWith('uefa.champions')) sched.push(...await teamSchedule(cfg.sp, tm.lg, tm.id, code, cfg.code, idToCode));
    for (const lg of (cfg.alsoIn ? cfg.alsoIn(tm) : [])) sched.push(...await teamSchedule(cfg.sp, lg, tm.id, code, cfg.code, idToCode));
  });
  console.log(`${cfg.sp}: ${teams.length} teams, ${roster.length} players; fetching game logs…`);
  let done = 0;
  const rows = await pool(roster, 10, async (p) => {
    let log = { n: 0 };
    try { log = await gameLog(cfg.logReqs(p), cfg.code, cfg.dateFn, cfg.seasonLabel, idToCode); } catch (e) { console.warn('skip', p.player, e.message); }
    if (++done % 100 === 0) console.log(`  ${done}/${roster.length}`);
    if (!log.n) return null;
    const { lg, ucl, ...rest } = p;
    return { ...rest, n: log.n, cols: log.cols.join(','), g: log.g };
  });
  const out = rows.filter(Boolean).sort((a, b) => a.player.localeCompare(b.player));
  fs.writeFileSync(path.join(DATA, cfg.file), JSON.stringify(out));
  console.log(`Wrote ${out.length} players to data/${cfg.file} (${(fs.statSync(path.join(DATA, cfg.file)).size / 1024 / 1024).toFixed(2)} MB)`);
  return sched;
}

(async () => {
  const only = process.argv[2];
  const sched = [];
  if (!only || only === 'nfl') sched.push(...await sport({
    sp: 'nfl', file: 'nflp.json', league: ['football/nfl'], code: (a) => NFL_CODE[a] || a, skip: NFL_SKIP,
    flatten: (r) => ((r && r.athletes) || []).filter((g) => g.position !== 'practiceSquad').flatMap((g) => g.items || []),
    seasonLabel: (s) => String(s), dateFn: usDate,
    logReqs: (p) => [2024, 2025, 2026].map((s) => ({ season: s, url: `${API}football/nfl/athletes/${p.pid}/gamelog?season=${s}` })),
  }));
  if (!only || only === 'soc') {
    // Champions League clubs (from fetch-ucl.js): their codes win, clubs outside the
    // Premier League and La Liga join the list, and every UCL club's players get UCL games.
    let ucl = [];
    try { ucl = JSON.parse(fs.readFileSync(path.join(DATA, 'ucl_teams.json'), 'utf8')); } catch (e) { console.warn('no ucl_teams.json: run npm run fetch:ucl first for Champions League clubs'); }
    const uclIds = new Set(ucl.map((t) => t.id));
    sched.push(...await sport({
      sp: 'soc', file: 'socp.json', league: ['soccer/eng.1', 'soccer/esp.1'], code: (a) => SOC_CODE[a] || a,
      extraTeams: ucl.filter((t) => !t.domestic).map((t) => ({ id: t.id, abbreviation: t.code, code: t.code, lg: 'soccer/' + t.lg })),
      codeById: Object.fromEntries(ucl.map((t) => [t.id, t.code])),
      alsoIn: (tm) => (uclIds.has(tm.id) ? ['soccer/uefa.champions'] : []),
      flatten: (r) => (r && r.athletes) || [],
      seasonLabel: (s) => `${s}-${String(s + 1).slice(2)}`, dateFn: ukDate,
      logReqs: (p) => {
        const lg = p.lg.split('/')[1], reqs = [];
        if (lg !== 'uefa.champions') [2024, 2025, 2026].forEach((s) => reqs.push({ season: s, url: `${API}soccer/athletes/${p.pid}/gamelog?season=${s}&league=${lg}` }));
        if (p.ucl) [2025, 2026].forEach((s) => reqs.push({ season: s, url: `${API}soccer/athletes/${p.pid}/gamelog?season=${s}&league=uefa.champions` }));
        return reqs;
      },
      tagPlayer: (p, tm) => { p.ucl = uclIds.has(tm.id); },
    }));
  }
  const file = path.join(DATA, 'tsched.json');
  let prev = [];
  if (only) { try { prev = JSON.parse(fs.readFileSync(file, 'utf8')).filter((r) => r.sp !== only); } catch (e) {} }
  const seen = new Set();
  const all = [...prev, ...sched].filter((r) => { const k = r.sp + r.team + r.iso; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => (a.iso < b.iso ? -1 : 1));
  fs.writeFileSync(file, JSON.stringify(all));
  console.log(`Wrote ${all.length} upcoming team games to data/tsched.json`);
})().catch((e) => { console.error(e); process.exit(1); });
