// Adds the Champions League to StatSniper's football data, in the same shape as the
// Premier League and La Liga rows, from ESPN's public feed.
// Usage: npm run fetch:ucl
//
// Writes public/data/ucl_teams.json (the 36 clubs: ESPN id, StatSniper code, name,
// domestic league, logo) and replaces the Champions League rows in fixtures.json
// (next matchday, with picks), table.json (league phase) and results.json (last matchday).
//
// Picks follow the page's method: provider chance (DraftKings moneylines with the margin
// removed) blended 50/50 with a form rating from a Poisson goals model built on each
// club's games this season in all competitions on ESPN.
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'public', 'data');
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/';
const LEAGUE = 'Champions League';
const SEASON = 2026;
const SOC_CODE = { BHA: 'BRI', CHE: 'CFC', LIV: 'LFC', MNC: 'MCI', MAN: 'MUN', CEL: 'RCC', RAY: 'RVC', BET: 'RBB', VAL: 'VCF' };
const NFL_CODES = 'ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAC KC LA LAC LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS'.split(' ');

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
const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const write = (f, d) => fs.writeFileSync(path.join(DATA, f), JSON.stringify(d));
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const sydTime = (iso) => {
  const d = new Date(iso);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day} ${p.month}, ${p.hour}:${p.minute} ${String(p.dayPeriod).toUpperCase()} AEDT`;
};

// League strength: goals scored and conceded against weaker opposition count for less. Each club gets the
// average strength of the competitions its games came from (Champions League games count as 1.0), and the
// winner model scales expected goals by (strength / opponent strength)^LK_POW. Rough UEFA-coefficient tiers.
const LEAGUE_K = { 'eng.1': 1, 'esp.1': 0.96, 'ger.1': 0.92, 'ita.1': 0.92, 'fra.1': 0.86, 'por.1': 0.78, 'ned.1': 0.76, 'bel.1': 0.72, 'tur.1': 0.7, 'aut.1': 0.66, 'sui.1': 0.66, 'sco.1': 0.64, 'gre.1': 0.64, 'cze.1': 0.64, 'den.1': 0.64, 'ukr.1': 0.62, 'nor.1': 0.6, 'cro.1': 0.6, 'srb.1': 0.58, 'cyp.1': 0.56, 'kaz.1': 0.5, 'aze.1': 0.5, 'uefa.champions': 1 };
const LK_POW = 1;
const compK = (lg) => LEAGUE_K[lg] ?? 0.62;

// Poisson model: chances of each scoreline up to 10 goals a side.
const pois = (l, k) => { let f = 1; for (let i = 2; i <= k; i++) f *= i; return Math.exp(-l) * l ** k / f; };
function model(lh, la) {
  let ph = 0, pd = 0, pa = 0, btts = 0, o15 = 0, o25 = 0, o35 = 0, best = [0, 0, -1];
  for (let h = 0; h <= 10; h++) for (let a = 0; a <= 10; a++) {
    const p = pois(lh, h) * pois(la, a);
    if (h > a) ph += p; else if (h === a) pd += p; else pa += p;
    if (h && a) btts += p; if (h + a > 1) o15 += p; if (h + a > 2) o25 += p; if (h + a > 3) o35 += p;
    if (p > best[2]) best = [h, a, p];
  }
  return { ph, pd, pa, btts, o15, o25, o35, score: best[0] + '-' + best[1] };
}
const implied = (ml) => (ml == null ? null : ml > 0 ? 100 / (ml + 100) : -ml / (-ml + 100));

// One club's completed games this season in its league and the Champions League.
async function teamGames(t) {
  const out = new Map();
  for (const lg of [t.lg, 'uefa.champions']) {
    const r = await getJson(`${SITE}${lg}/teams/${t.id}/schedule?season=${SEASON}`).catch(() => null);
    for (const ev of (r && r.events) || []) {
      const c = ev.competitions && ev.competitions[0];
      if (!c || !c.status || !c.status.type || !c.status.type.completed) continue;
      const me = c.competitors.find((x) => x.team && x.team.id === String(t.id)), op = c.competitors.find((x) => x !== me);
      if (!me || !op) continue;
      const sc = (x) => Number(x.score && typeof x.score === 'object' ? x.score.value : x.score);
      out.set(ev.id, { date: ev.date, home: me.homeAway === 'home', gf: sc(me), ga: sc(op), k: compK(lg) });
    }
  }
  return [...out.values()].filter((g) => Number.isFinite(g.gf) && Number.isFinite(g.ga));
}
function form(gs) {
  const frac = (f, list = gs) => list.filter(f).length + '/' + list.length;
  const rec = (list) => { const w = list.filter((g) => g.gf > g.ga).length, d = list.filter((g) => g.gf === g.ga).length; return `${w}W ${d}D ${list.length - w - d}L, ${list.reduce((s, g) => s + g.gf, 0)}-${list.reduce((s, g) => s + g.ga, 0)}`; };
  const home = gs.filter((g) => g.home), away = gs.filter((g) => !g.home);
  const n = gs.length || 1, pts = gs.reduce((s, g) => s + (g.gf > g.ga ? 3 : g.gf === g.ga ? 1 : 0), 0);
  return {
    n: gs.length, ppg: Math.round((pts / n) * 100) / 100, all: rec(gs), home: rec(home), away: rec(away), home_p: home.length, away_p: away.length,
    btts: frac((g) => g.gf && g.ga), btts_home: frac((g) => g.gf && g.ga, home), btts_away: frac((g) => g.gf && g.ga, away),
    o15: frac((g) => g.gf + g.ga > 1), o25: frac((g) => g.gf + g.ga > 2), o25_home: frac((g) => g.gf + g.ga > 2, home), o25_away: frac((g) => g.gf + g.ga > 2, away), o35: frac((g) => g.gf + g.ga > 3),
    gf: r2(gs.reduce((s, g) => s + g.gf, 0) / n), ga: r2(gs.reduce((s, g) => s + g.ga, 0) / n),
    avg_total: r2(gs.reduce((s, g) => s + g.gf + g.ga, 0) / n),
    cs: frac((g) => !g.ga), fts: frac((g) => !g.gf),
    k: gs.length ? r2(gs.reduce((s, g) => s + (g.k ?? 1), 0) / gs.length) : 1,
    gfHs: home.reduce((s, g) => s + g.gf, 0), gaHs: home.reduce((s, g) => s + g.ga, 0), gfAs: away.reduce((s, g) => s + g.gf, 0), gaAs: away.reduce((s, g) => s + g.ga, 0),
    gfH: home.length ? home.reduce((s, g) => s + g.gf, 0) / home.length : null, gaH: home.length ? home.reduce((s, g) => s + g.ga, 0) / home.length : null,
    gfA: away.length ? away.reduce((s, g) => s + g.gf, 0) / away.length : null, gaA: away.length ? away.reduce((s, g) => s + g.ga, 0) / away.length : null,
  };
}
const conf = (p) => (p >= 60 ? 'High' : p >= 48 ? 'Medium' : 'Low');
const sideConf = (p, edge = 50) => { const d = Math.abs(p - edge); return d >= 15 ? 'High' : d >= 7 ? 'Medium' : 'Low'; };

// One fixture's pick row in the page's football shape. `keep` is the fixture's previous row:
// hand-researched head-to-head, lineups and team news on it are kept.
const KEEP = ['h2h_text', 'h2h_season', 'home_xi', 'away_xi', 'home_news', 'away_news', 'lineup_source', 'lineup_status'];
function buildPick(league, id, e, c, H, A, fh, fa, checked, keep) {
  const avg = (x, y, d) => (x != null && y != null ? Math.sqrt(Math.max(x, 0.2) * Math.max(y, 0.2)) : d);
  const lh = avg(fh.gfH ?? fh.gf, fa.gaA ?? fa.ga, 1.4) * 1.08, la = avg(fa.gfA ?? fa.gf, fh.gaH ?? fh.ga, 1.1) * 0.94;
  const m = model(lh, la);
  // Winner model: venue rates shrunk towards average (3 games' worth) and scaled by league strength.
  const sh = (sum, n, prior) => (sum + prior * 3) / (n + 3);
  const rel = ((fh.k || 1) / (fa.k || 1)) ** LK_POW;
  const lhW = Math.sqrt(sh(fh.gfHs, fh.home_p, 1.4) * sh(fa.gaAs, fa.away_p, 1.2)) * 1.08 * rel;
  const laW = Math.sqrt(sh(fa.gfAs, fa.away_p, 1.2) * sh(fh.gaHs, fh.home_p, 1.1)) * 0.94 / rel;
  const mw = model(lhW, laW);
  const odds = (c.odds || [])[0] || {};
  // Current moneylines sit under moneyline.{home,away,draw}.close (open as a fallback); older feeds use *TeamOdds.moneyLine.
  const ml = (side) => { const m = odds.moneyline && odds.moneyline[side]; const v = m && ((m.close && m.close.odds) || (m.open && m.open.odds)); return v != null && v !== '' ? Number(String(v).replace('+', '')) : null; };
  let ph = implied(ml('home') ?? (odds.homeTeamOdds && odds.homeTeamOdds.moneyLine)), pa = implied(ml('away') ?? (odds.awayTeamOdds && odds.awayTeamOdds.moneyLine)), pd = implied(ml('draw') ?? (odds.drawOdds && odds.drawOdds.moneyLine));
  const hasOdds = ph != null && pa != null && pd != null;
  if (hasOdds) { const s = ph + pd + pa; ph /= s; pd /= s; pa /= s; } else { ph = m.ph; pd = m.pd; pa = m.pa; }
  const P = (x) => r1(x * 100);
  if (!hasOdds) { ph = mw.ph; pd = mw.pd; pa = mw.pa; }
  const fH = r1((P(ph) + P(mw.ph)) / 2), fD = r1((P(pd) + P(mw.pd)) / 2), fA = r1(100 - fH - fD);
  const best = [[fH, H.name + ' win'], [fD, 'Draw'], [fA, A.name + ' win']].sort((x, y) => y[0] - x[0])[0];
  const pB = Math.round(m.btts * 100), p25 = Math.round(m.o25 * 100);
  const row = {
    id, league, home: H.name, away: A.name, time: sydTime(e.date),
    p_home: P(ph), p_draw: P(pd), p_away: P(pa), m_home: P(mw.ph), m_away: P(mw.pa), home_k: fh.k, away_k: fa.k, f_home: fH, f_draw: fD, f_away: fA,
    pick: best[1], pick_pct: best[0], confidence: conf(best[0]),
    home_ppg: fh.ppg, away_ppg: fa.ppg, home_rank: H.rank, away_rank: A.rank,
    home_all: fh.all, home_home: fh.home, home_home_p: fh.home_p, away_all: fa.all, away_away: fa.away, away_away_p: fa.away_p,
    home_btts: fh.btts, away_btts: fa.btts, home_btts_home: fh.btts_home, away_btts_away: fa.btts_away,
    home_o25: fh.o25, away_o25: fa.o25, home_o25_home: fh.o25_home, away_o25_away: fa.o25_away,
    home_o15: fh.o15, away_o15: fa.o15, home_o35: fh.o35, away_o35: fa.o35,
    home_gf: fh.gf, home_ga: fh.ga, away_gf: fa.gf, away_ga: fa.ga, home_avg_total: fh.avg_total, away_avg_total: fa.avg_total,
    home_cs: fh.cs, away_cs: fa.cs, home_fts: fh.fts, away_fts: fa.fts,
    xg_home: r2(lh), xg_away: r2(la), xg_total: r2(lh + la), proj_score: m.score,
    p_btts: pB, p_o25: p25, p_o15: Math.round(m.o15 * 100),
    btts_pick: pB >= 50 ? 'Both score' : 'Not both', btts_conf: sideConf(pB),
    ou_pick: p25 >= 55 ? 'Over 2.5' : p25 <= 45 ? 'Under 2.5' : 'Coin toss', ou_conf: sideConf(p25),
    h2h_text: 'No head-to-head history on file for this fixture yet.', h2h_season: league === 'Champions League' ? 'First meeting in this season’s Champions League' : 'No meeting yet this season',
    home_xi: 'Not announced yet', away_xi: 'Not announced yet', home_news: 'No team news on file yet.', away_news: 'No team news on file yet.',
    lineup_source: 'ESPN', lineup_status: 'Not announced', checked,
    provider: hasOdds ? 'DraftKings' : 'none (model only)', total_line: odds.overUnder ?? null,
  };
  if (keep) for (const k of KEEP) if (keep[k] && !/^(No |Not announced)/.test(String(keep[k]))) row[k] = keep[k];
  if (keep && keep.lineup_status && keep.lineup_status !== 'Not announced') row.checked = keep.checked || row.checked;
  return row;
}

async function uclMain() {
  const table = read('table.json').filter((r) => r.league !== LEAGUE);
  const domestic = new Map(table.map((r) => [r.abbr, r.team]));
  // 1. The 36 clubs, with StatSniper codes that clash with nothing else.
  const st = await getJson('https://site.api.espn.com/apis/v2/sports/soccer/uefa.champions/standings');
  const entries = st.children[0].standings.entries;
  const used = new Set([...NFL_CODES]);
  const teams = [];
  for (const e of entries) {
    const t = e.team, info = await getJson(`${SITE}uefa.champions/teams/${t.id}`).catch(() => null);
    const href = ((info && info.team && info.team.defaultLeague && info.team.defaultLeague.links) || [])[0];
    const lg = href ? (href.href.match(/name\/([a-z]+\.\d)/) || [])[1] : null;
    let code = SOC_CODE[t.abbreviation] || t.abbreviation, name = t.displayName;
    const isDomestic = (lg === 'eng.1' || lg === 'esp.1') && domestic.has(code);
    if (isDomestic) name = domestic.get(code);
    else {
      const tries = [code, name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase(), name.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 3)];
      code = tries.find((c) => c.length >= 2 && !used.has(c) && !domestic.has(c)) || code + '2';
    }
    used.add(code);
    const s = Object.fromEntries(e.stats.map((x) => [x.abbreviation, x.value]));
    const logos = (info && info.team && info.team.logos) || t.logos || [];
    teams.push({ id: t.id, code, name, lg: lg || 'uefa.champions', domestic: isDomestic, rank: s.R, played: s.GP, w: s.W, d: s.D, l: s.L, pts: s.P, gd: s.GD, logos: logos.map((l) => ({ href: l.href, rel: l.rel })) });
  }
  write('ucl_teams.json', teams.map(({ rank, played, w, d, l, pts, gd, ...t }) => t));
  const byId = new Map(teams.map((t) => [t.id, t]));
  console.log(`${teams.length} clubs; ${teams.filter((t) => !t.domestic).length} outside the Premier League and La Liga`);

  // 2. League phase table.
  write('table.json', [...table, ...teams.map((t) => ({ league: LEAGUE, rank: t.rank, abbr: t.code, team: t.name, played: t.played, w: t.w, d: t.d, l: t.l, pts: t.pts, ppg: t.played ? Math.round((t.pts / t.played) * 100) / 100 : 0 }))]);

  // 3. Matches by month around today: last finished matchday and the next one.
  const now = new Date(), months = [-1, 0, 1, 2].map((k) => { const d = new Date(now.getFullYear(), now.getMonth() + k, 1); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`; });
  const events = [];
  for (const m of months) { const r = await getJson(`${SITE}uefa.champions/scoreboard?dates=${m}`).catch(() => null); events.push(...((r && r.events) || [])); }
  const done = events.filter((e) => e.status.type.completed).sort((a, b) => (a.date < b.date ? -1 : 1));
  const next = events.filter((e) => e.status.type.state === 'pre').sort((a, b) => (a.date < b.date ? -1 : 1));
  const round = (list, fromEnd) => { if (!list.length) return []; const anchor = new Date((fromEnd ? list[list.length - 1] : list[0]).date).getTime(); return list.filter((e) => Math.abs(new Date(e.date).getTime() - anchor) < 3 * 86400000); };
  const sides = (e) => { const c = e.competitions[0]; const h = c.competitors.find((x) => x.homeAway === 'home'), a = c.competitors.find((x) => x.homeAway === 'away'); return { c, h, a, H: byId.get(h.team.id), A: byId.get(a.team.id) }; };

  const results = read('results.json').filter((r) => r.league !== LEAGUE);
  round(done, true).forEach((e) => { const { h, a, H, A } = sides(e); results.push({ league: LEAGUE, home: H ? H.name : h.team.displayName, away: A ? A.name : a.team.displayName, hg: Number(h.score), ag: Number(a.score), score: `${h.score}-${a.score}` }); });
  write('results.json', results);

  // 4. Next matchday with picks.
  const formCache = new Map();
  const formOf = async (t) => { if (!formCache.has(t.id)) formCache.set(t.id, form(await teamGames(t))); return formCache.get(t.id); };
  const oldRows = read('fixtures.json');
  const fixtures = oldRows.filter((r) => r.league !== LEAGUE);
  const checked = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', hour12: true }).format(now) + ' Sydney';
  for (const e of round(next, false)) {
    const { c, H, A } = sides(e); if (!H || !A) continue;
    const fh = await formOf(H), fa = await formOf(A);
    const id = `UCL-${H.code}-${A.code}`;
    fixtures.push(buildPick(LEAGUE, id, e, c, H, A, fh, fa, checked, oldRows.find((r) => r.id === id)));
  }
  write('fixtures.json', fixtures);
  const ucl = fixtures.filter((x) => x.league === LEAGUE);
  console.log(`Table: ${teams.length} rows. Results: ${results.filter((r) => r.league === LEAGUE).length} from the last matchday. Fixtures: ${ucl.length} for ${ucl[0] ? ucl[0].time.split(',')[0] : '-'} onward (${ucl.filter((x) => x.provider === 'DraftKings').length} with DraftKings odds).`);
}

module.exports = { LEAGUE_K, compK, SITE, SEASON, SOC_CODE, getJson, read, write, r1, r2, sydTime, model, implied, teamGames, form, conf, sideConf, buildPick };
if (require.main === module) uclMain().catch((e) => { console.error(e); process.exit(1); });
