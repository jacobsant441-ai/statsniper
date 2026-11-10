// StatSniper NBA player page: market bar, Graph / Shooting / Similar / Types tabs, line card,
// filters, and a strip of the other players in his next game. Loaded after the main page script,
// so it uses that script's helpers (el, rows, plRow, plGames, h2hGames, plUpcoming, avatar, badge …).
// Data: pgl (game logs), h2h (older games vs each team), pbp (play-by-play extras, this season),
// troster (injuries), pstats / props75 / top (our prop lines), games / schedule (next game).
const SSX = window.SSX;
const { el, rows, plCur, plNeed, atNeed, plTeamNames, plRow, plGames, h2hGames, plUpcoming, plDate, plDraw, atLabel, atKeys, atGames, atRow, badge, bdX, norm, f1, avatar, openTeam, openPlayer, openAthlete, toView, MON, PL, AT, AT_DS, AT_HS, AT_CUR } = SSX;
let PM = 'nba'; // which page is drawing: 'nba' (pp) or 'at' (football / NFL athlete page)
const PP = { amk: {}, mk: 'pts', tab: 'graph', line: {}, f: { season: 'cur', range: 'all', h2h: false, venue: 'all', min: 0, type: 'reg' }, adv: false, zone: 'player', sim: 'role', drag: null };
let ppCurV = null, ppCurG = -1;
const ppCur = () => { if (PM !== 'nba') return AT_CUR[AT.sp]; if (ppCurG !== SSX.dataGen || !ppCurV) { ppCurV = plCur(); ppCurG = SSX.dataGen; } return ppCurV; };
const PB_K = ['q1p', 'q1r', 'q1a', 'h1p', 'h1r', 'h1a', 'q1t'];
const MKS = [
  ['pts', 'Points', 'Pts'], ['ast', 'Assists', 'Ast'], ['reb', 'Rebounds', 'Reb'], ['tpm', 'Threes', '3PM'],
  ['pa', 'Pts+Ast', 'P+A'], ['pr', 'Pts+Reb', 'P+R'], ['ra', 'Reb+Ast', 'R+A'], ['pra', 'Pts+Reb+Ast', 'PRA'],
  ['fan', 'Fantasy score', 'Fant'], ['dd', 'Double double', 'DD'], ['td', 'Triple double', 'TD'],
  ['q1p', '1Q Points', '1Q Pts'], ['q1r', '1Q Rebounds', '1Q Reb'], ['q1a', '1Q Assists', '1Q Ast'], ['q1t', '1Q Threes', '1Q 3PM'],
  ['h1p', '1H Points', '1H Pts'], ['h1r', '1H Rebounds', '1H Reb'], ['h1a', '1H Assists', '1H Ast'],
  ['stl', 'Steals', 'Stl'], ['blk', 'Blocks', 'Blk'], ['sb', 'Stl+Blk', 'S+B'], ['to', 'Turnovers', 'TO'], ['pf', 'Fouls', 'PF'],
  ['fgm', 'FG made', 'FGM'], ['fg2', '2PT made', '2PM'], ['fga', 'FG attempted', 'FGA'], ['tpa', '3PT attempted', '3PA'], ['ftm', 'FT made', 'FTM'], ['fta', 'FT attempted', 'FTA'], ['min', 'Minutes', 'Min'],
];
const MK_NAME0 = Object.fromEntries(MKS.map(([k, l]) => [k, l])), MK_SHORT0 = Object.fromEntries(MKS.map(([k, , s]) => [k, s]));
// Football / NFL markets: each stat column the player has, plus a few combos.
const AT_COMBO = { nfl: [['passingYards+rushingYards', 'Pass+Rush yds'], ['rushingYards+receivingYards', 'Rush+Rec yds'], ['passingTouchdowns+rushingTouchdowns', 'Pass+Rush TD'], ['rushingTouchdowns+receivingTouchdowns', 'Rush+Rec TD']], fb: [] };
const atMkLabel = (k) => { const c = (AT_COMBO[AT.sp] || []).find(([x]) => x === k); return c ? c[1] : atLabel(k) !== k ? atLabel(k) : k.replace(/([A-Z])/g, ' $1').replace(/^./, (c2) => c2.toUpperCase()); };
const MK_NAME = new Proxy({}, { get: (_, k) => (PM === 'nba' ? MK_NAME0[k] : atMkLabel(k)) });
const MK_SHORT = new Proxy({}, { get: (_, k) => (PM === 'nba' ? MK_SHORT0[k] : atMkLabel(k)) });
const atMarkets = (r, gs) => {
  const cols = String(r.cols || '').split(',').concat(AT.sp === 'fb' ? ['ga'] : []);
  const has = (c) => !/pct|percent|perpass|per[A-Z]|rating|qbr|average|avg/i.test(c) && gs.some((g) => typeof g.v[c] === 'number' && g.v[c] !== 0);
  const first = atKeys(r, gs).filter(has), rest = cols.filter((c) => !first.includes(c) && has(c));
  const combos = (AT_COMBO[AT.sp] || []).filter(([k]) => k.split('+').every((c) => cols.includes(c)) && k.split('+').some(has)).map(([k]) => k);
  return [...first, ...combos, ...rest].slice(0, 24);
};
const ppBinary = (k) => k === 'dd' || k === 'td';
const ppVal = (g, k) => {
  if (PM !== 'nba') { if (k.includes('+')) { const p2 = k.split('+').map((c) => g.v[c]); return p2.some((x) => typeof x === 'number') ? p2.reduce((a, b) => a + (Number(b) || 0), 0) : undefined; } const x = g.v[k]; return typeof x === 'number' ? x : undefined; }
  const ten = [g.pts, g.reb, g.ast, g.stl, g.blk].filter((v) => v >= 10).length;
  switch (k) {
    case 'pa': return g.pts + g.ast; case 'pr': return g.pts + g.reb; case 'ra': return g.reb + g.ast; case 'pra': return g.pts + g.reb + g.ast;
    case 'sb': return g.stl + g.blk; case 'fg2': return Math.max(0, (Number(g.fgm) || 0) - (Number(g.tpm) || 0)); case 'dd': return ten >= 2 ? 1 : 0; case 'td': return ten >= 3 ? 1 : 0;
    case 'fan': return Math.round((g.pts + 1.2 * g.reb + 1.5 * g.ast + 3 * g.stl + 3 * g.blk - g.to) * 10) / 10;
    default: if (PB_K.includes(k)) return g.pb ? g.pb[k] : undefined; return typeof g[k] === 'number' ? g[k] : Number(g[k]) || 0;
  }
};
// play-by-play row for a player, and his per-game 1Q / 1H numbers by date
const pbRows = () => rows('pbp');
const pbPlayer = (pid) => pbRows().find((r) => r.k === 'p' && String(r.pid) === String(pid));
const pbTeam = (team) => pbRows().find((r) => r.k === 't' && r.team === team);
const pbCache = new Map();
const pbGames = (pid) => {
  const r = pbPlayer(pid); if (!r) return new Map();
  const ck = pid + '|' + SSX.dataGen; if (pbCache.has(ck)) return pbCache.get(ck);
  const m = new Map(String(r.g || '').split(';').filter(Boolean).map((s) => { const a = s.split(','); return [a[0], Object.fromEntries(PB_K.map((k, i) => [k, Number(a[i + 1]) || 0]))]; }));
  pbCache.set(ck, m); return m;
};
const ppGames = (r) => { if (PM !== 'nba') return atGames(r); const pb = pbGames(r.pid); return [...plGames(r), ...h2hGames(r.pid).map((g) => ({ ...g, old: true }))].map((g) => ({ ...g, pb: pb.get(g.date) || null })); };
const ppNext = (r) => {
  if (PM === 'nba') return plUpcoming(r.team)[0] || null;
  const sp = AT.sp === 'nfl' ? 'nfl' : 'soc', now = Date.now();
  const u = rows('tsched').filter((x) => x.sp === sp && x.team === r.team && new Date(x.iso).getTime() > now - 3 * 3600000).sort((a, b) => (a.iso < b.iso ? -1 : 1))[0];
  if (!u) return null;
  const off = Math.max(0, Math.round((new Date(u.iso).getTime() - now) / 86400000));
  return { opp: u.opp, home: u.ha === 'H', day: new Date(u.iso).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Australia/Sydney' }), off, comp: u.comp, oppName: u.oppName };
};
const ppLogo = (code) => (PM === 'nba' ? badge(code) : bdX(code));
// Our line for this player and market: a prop line from our picks if we have one, otherwise the season-average line.
const PS_KEY = { pts: 'PTS', reb: 'REB', ast: 'AST', pra: 'PRA', tpm: '3PM' }, P75_KEY = { pts: 'Points', reb: 'Rebounds', ast: 'Assists', pra: 'Pts+reb+ast', tpm: 'Threes' };
const P75_NFL = { receptions: 'Receptions', receivingYards: 'Receiving yards', rushingYards: 'Rushing yards', passingYards: 'Passing yards', passingTouchdowns: 'Passing TDs', 'rushingYards+receivingYards': 'Rush+rec yards' };
const ppPosted = (r, k) => {
  const n = norm(r.player);
  if (PM !== 'nba') { const b = AT.sp === 'nfl' && P75_NFL[k] && rows('props75').find((x) => x.sport === 'nfl' && norm(x.player) === n && x.stat === P75_NFL[k]); return b ? b.line : null; }
  const a = PS_KEY[k] && rows('pstats').find((x) => norm(x.player) === n && x.stat === PS_KEY[k] && x.main_line != null); if (a) return a.main_line;
  const b = P75_KEY[k] && rows('props75').find((x) => (!x.sport || x.sport === 'nba') && norm(x.player) === n && x.stat === P75_KEY[k]); if (b) return b.line;
  const c = PS_KEY[k] && rows('top').find((x) => norm(x.player) === n && x.stat === PS_KEY[k]); if (c) return c.line;
  return null;
};
const ppSeasonAvg = (gs, k) => { const c = gs.filter((g) => !g.old && g.season === ppCur() && !Number(g.po)).map((g) => ppVal(g, k)).filter((v) => typeof v === 'number'); return c.length ? c.reduce((a, b) => a + b, 0) / c.length : null; };
// Bookmaker lines (props.json, Mac only: fetch-props.js) mapped to the profile's markets.
const BK_NBA = { PTS: 'pts', REB: 'reb', AST: 'ast', '3PM': 'tpm', STL: 'stl', BLK: 'blk', SB: 'sb', TOV: 'to', '2PM': 'fg2', PRA: 'pra', PR: 'pr', PA: 'pa', RA: 'ra', DD: 'dd', TD: 'td' };
const BK_NFL = { PYD: 'passingYards', PTD: 'passingTouchdowns', CMP: 'completions', PATT: 'passingAttempts', INT: 'interceptions', PLONG: 'longPassing', PRYD: 'passingYards+rushingYards', RYD: 'rushingYards', RATT: 'rushingAttempts', RLONG: 'longRushing', RTD: 'rushingTouchdowns', RECYD: 'receivingYards', REC: 'receptions', RECLONG: 'longReception', RRYD: 'rushingYards+receivingYards', DINT: 'interceptions', ATD: 'rushingTouchdowns+receivingTouchdowns', TDS: 'rushingTouchdowns+receivingTouchdowns' };
const BK_NAME = { FB: 'First basket', ATD: 'Anytime TD', FTD: 'First TD', LTD: 'Last TD', TDS: 'Touchdowns', DINT: 'Interceptions (defence)', INT: 'Interceptions thrown' };
const BK_YES = new Set(['DD', 'TD', 'FB', 'ATD', 'FTD', 'LTD']);
const bkSp = () => (PM === 'nba' ? 'nba' : AT.sp);
const bkMap = (sp) => (sp === 'nba' ? BK_NBA : sp === 'nfl' ? BK_NFL : {});
const bkLines = (r) => { const sp = bkSp(), n = norm(r.player), now = Date.now(); return rows('props').filter((x) => (x.sp || 'nba') === sp && norm(x.player) === n && (!x.kick || new Date(x.kick).getTime() > now - 4 * 3600000)); };
// The graph line: his main bookmaker line for this market (both sides priced, closest to even money).
const ppBook = (r, k) => { const m = bkMap(bkSp()); const c = bkLines(r).filter((x) => m[x.stat] === k && !BK_YES.has(x.stat) && x.over && x.under); return c.sort((a, b) => (b.main ? 1 : 0) - (a.main ? 1 : 0) || Math.abs(a.over - a.under) - Math.abs(b.over - b.under))[0] || null; };
// Bookie lines panel: every line posted for his next game, how often he went over it this season, and our chance.
function ppBookPanel(r, gs, k) {
  const sp = bkSp(), map = bkMap(sp), lines = bkLines(r); if (!lines.length) return null;
  const season = gs.filter((g) => !g.old && g.season === ppCur() && !Number(g.po)), n = norm(r.player), mode = PM;
  const ours = rows('propbook').filter((x) => (x.sp || 'nba') === sp && norm(x.player) === n);
  const by = {}; lines.forEach((x) => (by[x.stat] = by[x.stat] || []).push(x));
  const order = Object.keys(by).sort((a, b) => (map[b] === k) - (map[a] === k) || by[b].length - by[a].length);
  const wrap = el('div', null, 'ppcard ppbk');
  wrap.append(el('h3', 'Bookie lines · ' + lines.length), el('p', 'Every over / under the AU bookies have posted for ' + lines[0].day + ', how often he went over it this season, and our chance. Tap a line to graph it.', 'ppsrc'));
  order.forEach((st) => {
    const key = map[st], yes = BK_YES.has(st), list = by[st].sort((a, b) => a.line - b.line);
    const vals = key ? season.map((g) => ppVal(g, key)).filter((v) => typeof v === 'number') : [];
    const d = el('details', null, 'ppbkd'); if (key === k) d.open = true;
    const sm = el('summary'); const main = list.find((x) => x.main && x.over && x.under);
    sm.append(el('b', BK_NAME[st] || (key ? MK_NAME[key] : st)), el('span', (main ? 'line ' + main.line + ' · ' : '') + list.length + (list.length === 1 ? ' line' : ' lines'), 'muted'));
    d.append(sm, (() => { const h = el('div', null, 'ppbkr hd'); h.append(el('span', yes ? '' : 'Line'), el('span', yes ? 'Price' : 'Over · Under'), el('span', yes ? 'Season' : 'Went over'), el('span', 'Ours')); return h; })());
    list.forEach((x) => {
      const over = vals.filter((v) => v > x.line).length, pc = vals.length ? Math.round((100 * over) / vals.length) : null;
      const o = ours.find((q) => q.stat === st && q.line === x.line && q.side === 'over'), u = ours.find((q) => q.stat === st && q.line === x.line && q.side === 'under');
      const row = el('button', null, 'ppbkr'); row.type = 'button';
      const price = yes ? (x.over ? '$' + x.over.toFixed(2) : '–') : (x.over ? 'O $' + x.over.toFixed(2) : 'O –') + ' · ' + (x.under ? 'U $' + x.under.toFixed(2) : 'U –');
      const ch = o ? Math.round(o.chance) + '%' + (u && !yes ? ' / ' + Math.round(u.chance) : '') : '–';
      row.append(el('b', yes ? 'Yes' : String(x.line)), el('span', price, 'muted'), el('span', key && vals.length ? over + '/' + vals.length + ' · ' + pc + '%' : '–', pc == null ? '' : pc >= 60 ? 'up' : pc <= 40 ? 'dn' : ''), el('span', ch, o && o.chance >= 75 ? 'up' : u && u.chance >= 75 ? 'dn' : ''));
      row.title = o ? 'Our chance over ' + o.chance + '%' + (u ? ', under ' + u.chance + '%' : '') : 'No chance worked out for this line';
      if (key) row.addEventListener('click', () => { PM = mode; if (mode === 'nba') PP.mk = key; else PP.amk[AT.sp] = key; if (!yes) PP.line[mode + r.pid + '|' + key] = x.line; PP.tab = 'graph'; ppRedraw(); });
      d.append(row);
    });
    wrap.append(d);
  });
  return wrap;
}
// Best bets: open a player's profile on the market and line of a prop.
window.SSPP = { focus(sp, stat, line, player, pid) {
  const key = bkMap(sp)[stat];
  if (key) { if (sp === 'nba') PP.mk = key; else PP.amk[sp] = key; if (!BK_YES.has(stat)) PP.line[(sp === 'nba' ? 'nba' : 'at') + pid + '|' + key] = line; PP.tab = 'graph'; }
  if (sp === 'nba') openPlayer(player); else openAthlete(sp, pid);
} };
const ppLine = (r, gs, k) => {
  const key = PM + r.pid + '|' + k; const bk = ppBook(r, k);
  if (PP.line[key] != null) return { v: PP.line[key], src: 'Your line', bk: bk && bk.line === PP.line[key] ? bk : null };
  if (bk) return { v: bk.line, src: 'Bookmaker line (' + bk.books + ' AU books)', bk };
  const p = ppPosted(r, k); if (p != null) return { v: p, src: 'Our prop line' };
  if (ppBinary(k)) return { v: 0.5, src: 'Yes / no' };
  const a = ppSeasonAvg(gs, k) ?? (gs.length ? gs.slice(0, 10).reduce((s, g) => s + (ppVal(g, k) || 0), 0) / Math.min(10, gs.length) : 0);
  return { v: Math.max(0.5, Math.floor(a) + 0.5), src: 'Season-average line' };
};
const ppFilter = (r, gs, k) => {
  const f = PP.f, nx = ppNext(r), cur = ppCur();
  const seasons = [...new Set(gs.filter((g) => !g.old).map((g) => g.season))].sort().reverse();
  let out = gs.filter((g) => typeof ppVal(g, k) === 'number');
  if (f.h2h && nx) out = out.filter((g) => g.opp === nx.opp);
  else {
    out = out.filter((g) => !g.old);
    if (f.season === 'cur') out = out.filter((g) => g.season === cur);
    else if (f.season === 'last') out = out.filter((g) => g.season === seasons.find((s) => s < cur));
  }
  if (f.type === 'reg') out = out.filter((g) => !Number(g.po)); else if (f.type === 'po') out = out.filter((g) => Number(g.po));
  if (f.venue !== 'all') out = out.filter((g) => g.ha === f.venue);
  if (f.min) out = out.filter((g) => g.min >= f.min);
  out = out.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  if (f.range !== 'all') out = out.slice(-Number(f.range));
  else if (f.h2h) out = out.slice(-10);
  return out;
};
const ppSeasonLabel = () => { const f = PP.f, nx = PP.cur && ppNext(PP.cur); const b = f.h2h && nx ? 'vs ' + nx.opp + ' (all seasons)' : f.season === 'cur' ? 'Season ' + (ppCur().includes('-') ? ppCur().replace('-', '/').slice(2) : ppCur()) : f.season === 'last' ? 'Last season' : 'Last 3 seasons'; return b + (f.range !== 'all' ? ' · last ' + f.range : '') + (f.venue !== 'all' ? (f.venue === 'H' ? ' · home' : ' · away') : '') + (f.min ? ' · ' + f.min + '+ min' : '') + (f.type === 'po' ? ' · playoffs' : f.type === 'all' ? ' · incl. playoffs' : ''); };
const ppRedraw = () => { if (PM === 'nba') { dash.draw('pp'); dash.draw('ppstrip'); } else { dash.draw('atpp'); dash.draw('atstrip'); } };
const ppSetLine = (r, k, v) => { PP.line[PM + r.pid + '|' + k] = Math.max(0.5, Math.floor(v) + 0.5); };
const ppMon = (iso) => { const [, m, d] = String(iso).split('-').map(Number); return [MON[m - 1].slice(0, 3), String(d)]; };

dash.draw('pp', (box) => { PM = 'nba'; const r = plNeed(box); if (!r) return; ppBuild(box, r); });
dash.draw('atpp', (box) => { PM = 'at'; try { const r = atNeed(box); if (r) ppBuild(box, r); } finally { PM = 'nba'; } });
function ppBuild(box, r) {
  PP.cur = r;
  const gs = ppGames(r), nx = ppNext(r), tn = PM === 'nba' ? plTeamNames() : {};
  const mks = PM === 'nba' ? MKS.map(([k2]) => k2) : atMarkets(r, gs);
  if (PM !== 'nba' && !mks.includes(PP.amk[AT.sp])) PP.amk[AT.sp] = mks[0];
  const k = PM === 'nba' ? PP.mk : PP.amk[AT.sp];
  if (!k) { box.replaceChildren(el('p', 'No game stats on file for him yet.', 'plnone')); return; }
  const mkbar = el('div', null, 'ppmk');
  mks.forEach((key) => { const b = el('button', MK_NAME[key], key === k ? 'on' : ''); b.type = 'button'; const mode = PM; b.addEventListener('click', () => { PM = mode; if (mode === 'nba') PP.mk = key; else PP.amk[AT.sp] = key; ppRedraw(); }); mkbar.append(b); });
  requestAnimationFrame(() => { const on = mkbar.querySelector('.on'); if (on) mkbar.scrollLeft = on.offsetLeft - 16; });
  const tabs = el('div', null, 'pptabs');
  const TB = PM === 'nba' ? [['graph', '▥', 'Graph'], ['shoot', '◎', 'Shooting'], ['sim', '⚇', 'Similar'], ['types', '⋰', 'Types']] : [['graph', '▥', 'Graph'], ['sim', '⚇', 'Similar'], ['split', '⇆', 'Splits']];
  if (!TB.some(([t]) => t === PP.tab)) PP.tab = 'graph';
  const mode0 = PM;
  TB.forEach(([t, ic, l]) => { const b = el('button', null, t === PP.tab ? 'on' : ''); b.type = 'button'; b.append(el('span', ic, 'ic'), document.createTextNode(l)); b.addEventListener('click', () => { PM = mode0; PP.tab = t; ppRedraw(); }); tabs.append(b); });

  // ---- line card
  const L = ppLine(r, gs, k), fg = ppFilter(r, gs, k), vals = fg.map((g) => ppVal(g, k));
  const sAvg = ppSeasonAvg(gs, k), gAvg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  const over = vals.filter((v) => v > L.v).length;
  const card = el('div', null, 'ppcard');
  const top = el('div', null, 'pptop');
  const av = avatar(PM === 'nba' ? 'nba' : AT_HS[AT.sp], r.pid, r.player, 'big'); const ph = el('div', null, 'ppav'); ph.append(av);
  const inj = (() => { if (PM !== 'nba' && AT.sp !== 'nfl') return r.status && !/active/i.test(r.status) ? r.status : ''; const t = rows('troster').find((x) => x.sp === (PM === 'nba' ? 'nba' : 'nfl') && x.code === r.team); const e = t && (t.inj.find((x) => String(x[0]) === String(r.pid)) || t.inj.find((x) => norm(x[1]) === norm(r.player))); return e ? e[3] : ''; })();
  if (inj) ph.append(el('span', /out/i.test(inj) ? 'OUT' : /doubt/i.test(inj) ? 'DOUBT' : /day/i.test(inj) ? 'DTD' : /prob/i.test(inj) ? 'PROB' : 'QUES', 'ppinj' + (/out/i.test(inj) ? ' out' : '')));
  const who = el('div', null, 'ppwho');
  const nmr = el('div', null, 'ppnm'); const tb = ppLogo(r.team); tb.classList.add('tmlink'); tb.title = 'Team page'; const tsp = PM === 'nba' ? 'nba' : AT.sp; tb.addEventListener('click', () => openTeam(tsp, r.team));
  nmr.append(tb, el('b', r.player), el('span', r.pos || '', 'pos'));
  const lr = el('div', null, 'ppln');
  const big = PM !== 'nba' && /yards|Yards/.test(k) ? 5 : 1; const step = (d) => { const b = el('button', d < 0 ? '−' : '+', 'pm'); b.type = 'button'; b.setAttribute('aria-label', d < 0 ? 'Lower line' : 'Raise line'); const mode = PM; b.addEventListener('click', () => { PM = mode; ppSetLine(r, k, L.v + d * big); ppRedraw(); }); return b; };
  lr.append(el('b', ppBinary(k) ? 'Yes / no' : String(L.v), 'v'), el('span', MK_SHORT[k], 'mkl'), el('span', 'O ' + over + ' · U ' + (vals.length - over), 'ou'));
  if (L.bk) lr.append(el('span', 'O $' + (L.bk.over ? L.bk.over.toFixed(2) : '–') + ' · U $' + (L.bk.under ? L.bk.under.toFixed(2) : '–'), 'odds'));
  if (!ppBinary(k)) lr.append(step(-1), step(1));
  who.append(nmr, lr, el('div', L.src + (nx ? ' · next: ' + (nx.home ? 'vs ' : '@ ') + nx.opp + ' ' + nx.day : ''), 'ppsrc'));
  top.append(ph, who);
  const pct = vals.length ? Math.round((100 * over) / vals.length) : 0;
  const st = el('div', null, 'ppst');
  const cell = (lab, v, cls) => { const d = el('div', null, cls || ''); d.append(el('span', lab), el('b', v)); return d; };
  const cls = (v) => (v == null ? '' : ppBinary(k) ? '' : v > L.v ? 'up' : v < L.v ? 'dn' : '');
  st.append(cell('Season avg', sAvg == null ? '–' : ppBinary(k) ? Math.round(sAvg * 100) + '%' : f1(sAvg), cls(sAvg)), cell('Graph avg', gAvg == null ? '–' : ppBinary(k) ? Math.round(gAvg * 100) + '%' : f1(gAvg), cls(gAvg)), cell('Hit rate', pct + '% (' + over + '/' + vals.length + ')', pct >= 60 ? 'up' : pct <= 40 ? 'dn' : ''));
  card.append(top, st);
  const bkp = ppBookPanel(r, gs, k);

  const body = el('div', null, 'ppbody');
  if (PP.tab === 'graph') body.append(...ppGraph(r, k, fg, L, nx, gs));
  else if (PP.tab === 'shoot') body.append(...ppShoot(r, nx));
  else if (PP.tab === 'sim') body.append(...ppSim(r, k, nx, tn));
  else if (PP.tab === 'split') body.append(...ppSplits(r, k, gs, L));
  else body.append(...ppTypes(r, nx));
  box.replaceChildren(...[mkbar, tabs, card, bkp, body].filter(Boolean));
}

// ---- Graph tab
function ppGraph(r, k, fg, L, nx, gs) {
  const out = [];
  const pbNote = PB_K.includes(k) ? el('p', '1st-quarter and 1st-half numbers come from ESPN play-by-play, this season only.', 'muted ppnote') : null;
  if (!fg.length) { out.push(el('div', 'No games match your filters.', 'ppempty')); const b = el('button', 'Clear filters', 'ppclear'); b.type = 'button'; const mode = PM; b.addEventListener('click', () => { PM = mode; PP.f = { season: 'cur', range: 'all', h2h: false, venue: 'all', min: 0, type: 'reg' }; ppRedraw(); }); out.push(b); }
  else {
    const vals = fg.map((g) => ppVal(g, k));
    const max = Math.max(1, ...vals, L.v) * 1.15;
    const g = el('div', null, 'ppg');
    const axis = el('div', null, 'ppax');
    const seen = new Set();
    [1, 2 / 3, 1 / 3, 0].filter((f) => f === 0 || Math.abs(f - L.v / max) > 0.07).forEach((f) => { if (ppBinary(k)) return; const v = max < 6 ? Math.round(max * f * 2) / 2 : Math.round(max * f); if (seen.has(v)) return; seen.add(v); const t = el('span', String(v)); t.style.bottom = (100 * v) / max + '%'; axis.append(t); });
    const sc = el('div', null, 'ppsc'); const bars = el('div', null, 'ppbars');
    const cells = fg.map((x, i) => {
      const v = vals[i], c = el('button', null, 'ppb ' + (v > L.v ? 'up' : v < L.v ? 'dn' : 'eq')); c.type = 'button';
      const bar = el('i'); bar.style.height = 'calc((100% - 58px) * ' + Math.max(0.015, v / max) + ')'; /* the bottom 58px of each column holds the labels */ bar.append(el('em', ppBinary(k) ? (v ? 'Yes' : 'No') : String(v)));
      const [mo, d] = ppMon(x.date);
      const lab = el('div', null, 'ppl'); const lg = ppLogo(x.opp); lab.append(lg, el('small', mo), el('small', d + (x.old || x.season !== ppCur() ? " '" + x.date.slice(2, 4) : ''), 'd')); if (typeof x.min === 'number') lab.append(el('small', Math.round(x.min) + 'm', 'm'));
      c.title = plDate(x.date) + ' ' + (x.ha === 'H' ? 'vs ' : '@ ') + x.opp + ' · ' + x.res + ' ' + x.score + ' · ' + MK_NAME[k] + ' ' + v + (typeof x.min === 'number' ? ' · ' + Math.round(x.min) + ' min' : '');
      c.append(bar, lab); bars.append(c); return c;
    });
    if (nx) { const c = el('div', null, 'ppb next'); const bar = el('i'); bar.style.height = 'calc((100% - 58px) * ' + Math.max(0.04, L.v / max) + ')'; bar.append(el('em', '?')); const [mo, d] = ppMon(new Date(Date.now() + (nx.off || 0) * 86400000).toISOString().slice(0, 10)); const lab = el('div', null, 'ppl'); lab.append(ppLogo(nx.opp), el('small', mo), el('small', d, 'd'), el('small', 'next', 'm')); c.title = 'Next game: ' + (nx.home ? 'vs ' : '@ ') + nx.opp + ' ' + nx.day; c.append(bar, lab); bars.append(c); }
    sc.append(bars);
    const ov = el('div', null, 'ppov');
    const line = el('div', null, 'ppline'); line.style.bottom = (100 * L.v) / max + '%';
    const tag = el('span', null, 'pptag'); tag.append(el('b', null, 'cv')); line.append(tag);
    ov.append(line);
    const plot = el('div', null, 'ppplot'); plot.append(sc, ov);
    g.append(axis, plot);
    // Drag the line: bars recolour and the header's hit rate follows (CSS counters), then the page redraws on release.
    const wrapId = PM === 'nba' ? '#ppwrap' : '#atppwrap'; const card = () => document.querySelector(wrapId);
    const setVars = (v) => {
      const o = vals.filter((x) => x > v).length, w = card(); if (!w) return;
      w.style.setProperty('--li', Math.floor(v)); w.style.setProperty('--hp', Math.round((100 * o) / vals.length)); w.style.setProperty('--ho', o); w.style.setProperty('--hn', vals.length);
      line.style.bottom = (100 * v) / max + '%'; cells.forEach((c, i) => { c.classList.toggle('up', vals[i] > v); c.classList.toggle('dn', vals[i] < v); c.classList.toggle('eq', vals[i] === v); });
    };
    let cur = L.v;
    const at = (y) => { const rc = bars.getBoundingClientRect(); return Math.max(0.5, Math.floor(((rc.bottom - 58 - y) / (rc.height - 58)) * max) + 0.5); };
    if (!ppBinary(k)) {
      line.addEventListener('pointerdown', (e) => { PP.drag = true; g.classList.add('drag'); try { line.setPointerCapture(e.pointerId); } catch (x) {} cur = at(e.clientY); setVars(cur); e.preventDefault(); });
      line.addEventListener('pointermove', (e) => { if (!PP.drag) return; cur = at(e.clientY); setVars(cur); });
      const mode = PM; const up = () => { if (!PP.drag) return; PP.drag = false; g.classList.remove('drag'); PM = mode; ppSetLine(r, k, cur); ppRedraw(); };
      line.addEventListener('pointerup', up); line.addEventListener('pointercancel', up);
    }
    requestAnimationFrame(() => { sc.scrollLeft = sc.scrollWidth; const w = card(); if (w) { w.style.setProperty('--li', Math.floor(L.v)); } });
    out.push(g, el('div', ppBinary(k) ? 'YES / NO' : '⇕ Drag the line', 'pphint'));
  }
  out.push(el('p', ppSeasonLabel() + ' | Use filters below to refine', 'ppfl'));
  if (pbNote) out.push(pbNote);
  out.push(ppFilters(r, gs, k));
  return out;
}
function ppFilters(r, gs, k) {
  const f = PP.f, nx = ppNext(r);
  const box = el('div', null, 'ppfil');
  const mode0 = PM; const seg = el('div', null, 'ppseg'); [['sug', 'Suggested'], ['all', 'All filters']].forEach(([v, l]) => { const b = el('button', l, (PP.adv ? 'all' : 'sug') === v ? 'on' : ''); b.type = 'button'; b.addEventListener('click', () => { PM = mode0; PP.adv = v === 'all'; ppRedraw(); }); seg.append(b); });
  box.append(seg);
  const mode = PM, hasMin = gs.some((g) => typeof g.min === 'number' && g.min > 0);
  const chip = (l, on, fn) => { const b = el('button', l, 'ppchip' + (on ? ' on' : '')); b.type = 'button'; b.addEventListener('click', () => { PM = mode; fn(); ppRedraw(); }); return b; };
  const row = (title, ...cs) => { const d = el('div', null, 'pprow'); if (title) d.append(el('span', title, 'lb')); const c = el('div', null, 'ppchips'); c.append(...cs); d.append(c); return d; };
  const sug = el('div', null, 'ppchips');
  sug.append(chip('L3 seasons', f.season === 'l3' && !f.h2h, () => { f.season = f.season === 'l3' ? 'cur' : 'l3'; f.h2h = false; }),
    chip('L5', f.range === '5', () => { f.range = f.range === '5' ? 'all' : '5'; }), chip('L10', f.range === '10', () => { f.range = f.range === '10' ? 'all' : '10'; }), chip('L15', f.range === '15', () => { f.range = f.range === '15' ? 'all' : '15'; }));
  if (nx) sug.append(chip('H2H vs ' + nx.opp, f.h2h, () => { f.h2h = !f.h2h; }), chip(nx.home ? 'Home games' : 'Away games', f.venue === (nx.home ? 'H' : 'A'), () => { const v = nx.home ? 'H' : 'A'; f.venue = f.venue === v ? 'all' : v; }));
  if (hasMin) sug.append(chip('25+ min', f.min === 25, () => { f.min = f.min === 25 ? 0 : 25; }));
  box.append(sug);
  if (PP.adv) {
    box.append(row('Season', ...[['cur', 'This season'], ['last', 'Last season'], ['l3', 'Last 3 seasons']].map(([v, l]) => chip(l, f.season === v && !f.h2h, () => { f.season = v; f.h2h = false; }))),
      row('Games', ...[['all', 'All'], ['5', 'L5'], ['10', 'L10'], ['15', 'L15'], ['20', 'L20']].map(([v, l]) => chip(l, f.range === v, () => { f.range = v; }))),
      row('Venue', ...[['all', 'All'], ['H', 'Home'], ['A', 'Away']].map(([v, l]) => chip(l, f.venue === v, () => { f.venue = v; }))),
      ...(hasMin ? [row('Minutes', ...[[0, 'Any'], [20, '20+'], [25, '25+'], [30, '30+'], [35, '35+']].map(([v, l]) => chip(l, f.min === v, () => { f.min = v; }))),
      row('Games type', ...[['reg', 'Regular season'], ['po', 'Playoffs'], ['all', 'Both']].map(([v, l]) => chip(l, f.type === v, () => { f.type = v; })))] : []));
    if (nx) box.append(row('Opponent', chip('H2H vs ' + nx.opp + ' (last 10, any season)', f.h2h, () => { f.h2h = !f.h2h; })));
  }
  const clr = el('button', 'Reset filters', 'ppclear'); clr.type = 'button'; clr.addEventListener('click', () => { PM = mode; PP.f = { season: 'cur', range: 'all', h2h: false, venue: 'all', min: 0, type: 'reg' }; ppRedraw(); });
  box.append(clr);
  return box;
}

// ---- Shooting tab: court zones (player vs the next opponent's defence) and shot types
const ZN = [['lc', 'Left corner 3'], ['ra', 'Restricted area'], ['rc', 'Right corner 3'], ['paint', 'Paint'], ['mid', 'Mid-range'], ['atb', 'Above the break 3']];
const rkCls = (n) => (n == null ? 'na' : n >= 21 ? 'soft' : n >= 11 ? 'mid' : 'hard');
const pctS = (a) => (a && a[0] ? Math.round((100 * a[1]) / a[0]) + '%' : '–');
function ppLeague() {
  const ts = pbRows().filter((x) => x.k === 't'); const z = {}, s = {};
  ts.forEach((t) => { Object.entries(t.z).forEach(([k, a]) => { z[k] = z[k] || [0, 0]; z[k][0] += a[0]; z[k][1] += a[1]; }); Object.entries(t.st).forEach(([k, a]) => { s[k] = s[k] || [0, 0]; s[k][0] += a[0]; s[k][1] += a[1]; }); });
  return { z, s };
}
function ppShoot(r, nx) {
  const P = pbPlayer(r.pid), D = nx && pbTeam(nx.opp), lg = ppLeague();
  if (!P) return [el('div', 'No shot data for him this season yet.', 'ppempty')];
  const out = [];
  const h = el('div', null, 'pph'); h.append(el('h3', 'Shooting zones'), el('span', ppCur() + ' season · ' + P.n + ' games', 'muted'));
  const tg = el('div', null, 'ppvs');
  [['player', 'Player'], ['def', nx ? nx.opp + ' defence' : 'Opp defence']].forEach(([v, l], i) => { if (i) tg.append(el('span', 'vs', 'x')); const b = el('button', l, PP.zone === v ? 'on' : ''); b.type = 'button'; if (v === 'def' && !D) b.disabled = true; b.addEventListener('click', () => { PP.zone = v; ppRedraw(); }); tg.append(b); });
  out.push(h, tg);
  const tot = Object.values(P.z).reduce((s, a) => s + a[0], 0) || 1;
  const def = PP.zone === 'def' && D;
  const colour = (k) => { if (def) return rkCls(D.rk['z_' + k]); const p = P.z[k], l = lg.z[k]; if (!p || p[0] < 3 || !l || !l[0]) return 'na'; const d = p[1] / p[0] - l[1] / l[0]; return d >= 0.05 ? 'soft' : d <= -0.05 ? 'hard' : 'mid'; };
  const label = (k) => (def ? pctS(D.z[k]) + ' | #' + (D.rk['z_' + k] ?? '–') : Math.round((100 * P.z[k][0]) / tot) + '% | ' + (D ? '#' + (D.rk['z_' + k] ?? '–') : pctS(P.z[k])));
  const svg = `<svg viewBox="0 0 50 34" class="ppcourt" role="img" aria-label="Shooting zones">
<rect x="0" y="0" width="50" height="34" class="z ${colour('atb')}"/>
<path d="M3 0 L3 14 A23.75 23.75 0 0 0 47 14 L47 0 Z" class="z ${colour('mid')}"/>
<rect x="0" y="0" width="3" height="14" class="z ${colour('lc')}"/><rect x="47" y="0" width="3" height="14" class="z ${colour('rc')}"/>
<rect x="17" y="0" width="16" height="19" class="z ${colour('paint')}"/>
<path d="M21 0 L21 5.25 A4 4 0 0 0 29 5.25 L29 0 Z" class="z ${colour('ra')}"/>
<g class="ln"><path d="M3 0 L3 14 A23.75 23.75 0 0 0 47 14 L47 0"/><rect x="17" y="0" width="16" height="19"/><path d="M21 5.25 A4 4 0 0 0 29 5.25"/><path d="M19 19 A6 6 0 0 0 31 19"/><circle cx="25" cy="5.25" r=".75"/><path d="M22 4 L28 4"/></g></svg>`;
  const court = el('div', null, 'ppcourtw'); court.innerHTML = svg;
  const pos = { lc: [5.5, 30], rc: [94.5, 30], ra: [50, 24], paint: [50, 47], mid: [50, 71], atb: [50, 90] };
  ZN.forEach(([k, n]) => { const t = el('span', label(k), 'pplab ' + k); t.style.left = pos[k][0] + '%'; t.style.top = pos[k][1] + '%'; t.title = n; court.append(t); });
  out.push(court, el('p', def ? 'FG% the ' + nx.opp + ' defence allows in each zone and its rank (#1 allows the lowest). Green = soft spot for him, red = tough.' : 'Share of his shots from each zone' + (D ? ' and the ' + nx.opp + ' defence rank there (#1 = toughest)' : ' and his FG%') + '. Colour: his FG% against the league (green above, red below).', 'muted ppnote'));
  // shot types
  const st = [['cs', 'C&S'], ['close', '< 10 ft'], ['pu', 'Pull up']];
  const stot = st.reduce((s, [k]) => s + P.st[k][0], 0) || 1;
  const h2 = el('div', null, 'pph'); h2.append(el('h3', 'Shot type analysis'), el('span', ppCur() + ' season', 'muted'));
  const heads = el('div', null, 'ppsth'), bar = el('div', null, 'ppstb');
  st.forEach(([k, l]) => { const w = Math.max(14, (100 * P.st[k][0]) / stot); const hh = el('span', l); hh.style.flex = w; heads.append(hh); const s = el('span', Math.round((100 * P.st[k][0]) / stot) + '% | ' + (D ? '#' + (D.rk['st_' + k] ?? '–') : pctS(P.st[k])), 'seg ' + (D ? rkCls(D.rk['st_' + k]) : 'mid')); s.style.flex = w; s.title = l + ': ' + P.st[k][1] + ' of ' + P.st[k][0] + ' made (' + pctS(P.st[k]) + ')'; bar.append(s); });
  const tbl = el('div', null, 'ppstt'); st.forEach(([k, l]) => { const d = el('div'); d.append(el('span', l), el('b', P.st[k][1] + '/' + P.st[k][0] + ' · ' + pctS(P.st[k])), el('small', D ? nx.opp + ' allow ' + pctS(D.st[k]) + ' (#' + (D.rk['st_' + k] ?? '–') + ')' : 'League ' + pctS(lg.s[k]))); tbl.append(d); });
  out.push(h2, heads, bar, tbl, el('p', 'C&S: catch-and-shoot jumpers from 10 ft or more. Pull up: off-the-dribble jumpers (pull-ups, step-backs, fadeaways). From ESPN play-by-play shot types.', 'muted ppnote'));
  return out;
}

// ---- Similar tab: players like him against his next opponent this season
// Same-sport players at his position, each with games carrying the 1Q / 1H numbers when needed.
const ppPool = (pos, k) => {
  if (PM === 'nba') return rows('pgl').filter((p) => p.pos === pos).map((p) => { const pbm = PB_K.includes(k) ? pbGames(p.pid) : null; return { p, gs: plGames(p).map((g) => ({ ...g, pb: pbm ? pbm.get(g.date) || null : null })) }; });
  const grp = (x) => (AT.sp === 'fb' ? (x === 'GK' ? 'G' : x) : ['WR', 'TE'].includes(x) ? 'WR' : x);
  return rows(AT_DS[AT.sp]).filter((p) => grp(p.pos) === grp(pos)).map((p) => ({ p, gs: atGames(p) }));
};
const POSN = { nba: { G: 'guards', F: 'forwards', C: 'centres' }, nfl: { QB: 'quarterbacks', RB: 'running backs', WR: 'receivers', TE: 'receivers and tight ends' }, fb: { G: 'goalkeepers', D: 'defenders', M: 'midfielders', F: 'forwards' } };
const posName = (pos) => (POSN[PM === 'nba' ? 'nba' : AT.sp] || {})[pos] || (pos ? pos + 's' : 'players');
function ppSim(r, k, nx, tn) {
  if (!nx) return [el('div', 'No upcoming game on file, so there is no opponent to compare.', 'ppempty')];
  const cur = ppCur(), pos = r.pos, me = ppSeasonAvg(ppGames(r), k), mode = PM;
  const out = [];
  const h = el('div', null, 'pph'); h.append(el('h3', 'Similar players ' + MK_SHORT[k] + ' vs ' + (tn[nx.opp] || nx.opp)), el('span', cur + ' season', 'muted'));
  const tg = el('div', null, 'ppseg'); [['role', 'By role'], ['pos', 'By position']].forEach(([v, l]) => { const b = el('button', l, PP.sim === v ? 'on' : ''); b.type = 'button'; b.addEventListener('click', () => { PP.sim = v; ppRedraw(); }); tg.append(b); });
  tg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { PM = mode; }, true));
  out.push(h, tg);
  const list = [];
  ppPool(pos, k).forEach(({ p, gs }) => {
    if (p.pid === r.pid) return;
    const avg = ppSeasonAvg(gs, k); if (avg == null || avg <= 0) return;
    if (PP.sim === 'role' && me != null && (avg < me * 0.65 || avg > me * 1.35)) return;
    gs.filter((g) => g.season === cur && g.opp === nx.opp && !Number(g.po)).forEach((g) => { const v = ppVal(g, k); if (typeof v !== 'number') return; const line = ppBinary(k) ? 0.5 : Math.max(0.5, Math.floor(avg) + 0.5); list.push({ date: g.date, team: p.team, player: p.player, pid: p.pid, line, v, diff: ppBinary(k) ? (v ? 100 : -100) : Math.round((100 * (v - line)) / line) }); });
  });
  list.sort((a, b) => (a.date < b.date ? 1 : -1));
  const n = list.length, hit = list.filter((x) => x.v > x.line).length;
  const ad = n ? list.reduce((s, x) => s + (x.v - x.line), 0) / n : null, adp = n ? Math.round(list.reduce((s, x) => s + x.diff, 0) / n) : null;
  const st = el('div', null, 'ppst');
  const cell = (lab, v, c) => { const d = el('div', null, c); d.append(el('span', lab), el('b', v)); return d; };
  st.append(cell('Avg diff', ad == null ? '–' : (ad > 0 ? '+' : '') + f1(ad), ad > 0 ? 'up' : ad < 0 ? 'dn' : ''), cell('Avg diff %', adp == null ? '–' : (adp > 0 ? '+' : '') + adp + '%', adp > 0 ? 'up' : adp < 0 ? 'dn' : ''), cell('Hit rate', n ? Math.round((100 * hit) / n) + '% (' + hit + '/' + n + ')' : '–', n && hit / n >= 0.6 ? 'up' : n && hit / n <= 0.4 ? 'dn' : ''));
  out.push(st);
  // Defence vs position: what this opponent allows per game to this position, ranked across the league.
  const dvp = ppDvp(k, pos, cur);
  if (dvp[nx.opp]) out.push(el('p', (tn[nx.opp] || nx.opp) + ' allow ' + f1(dvp[nx.opp].v) + ' ' + MK_SHORT[k] + ' a game to ' + posName(pos) + ': #' + dvp[nx.opp].rk + ' of ' + Object.keys(dvp).length + ' (#1 allows the least).', 'ppdvp ' + rkCls(dvp[nx.opp].rk)));
  if (!n) { out.push(el('div', 'No similar players have faced ' + nx.opp + ' yet this season.', 'ppempty')); return out; }
  const t = el('table', null, 'pptbl'); const hr = el('tr'); ['Date', 'Team', 'Player', 'Line', 'Result', 'Diff %'].forEach((x, i) => hr.append(el('th', x, i >= 3 ? 'n' : ''))); t.append(hr);
  list.slice(0, 30).forEach((x) => { const tr = el('tr'); const [mo, d] = ppMon(x.date); const pl = el('td'); const sp = x.player.split(' '); const b = el('button', sp[0][0] + '. ' + sp.slice(1).join(' '), 'pplink'); b.title = x.player; b.type = 'button'; b.addEventListener('click', () => (mode === 'nba' ? openPlayer(x.player) : openAthlete(AT.sp, x.pid))); pl.append(b); tr.append(el('td', mo + ' ' + d), el('td', x.team), pl, el('td', ppBinary(k) ? 'Yes' : String(x.line), 'n'), el('td', ppBinary(k) ? (x.v ? 'Yes' : 'No') : String(x.v), 'n')); const dd = el('td', null, 'n'); dd.append(el('span', (x.diff > 0 ? '+' : '') + x.diff + '%', 'pill ' + (x.diff > 0 ? 'up' : x.diff < 0 ? 'dn' : ''))); tr.append(dd); t.append(tr); });
  const w = el('div', null, 'scroll'); w.append(t); out.push(w, el('p', (PP.sim === 'role' ? 'Same position with a season average within 35% of his. ' : 'Every one of the ' + posName(pos) + '. ') + 'Line = each player\'s season-average line (we have no posted lines for past games). Tap a name for their page.', 'muted ppnote'));
  return out;
}
const dvpCache = new Map();
function ppDvp(k, pos, cur) {
  const ck = PM + (AT.sp || '') + k + pos + cur + SSX.dataGen; if (dvpCache.has(ck)) return dvpCache.get(ck);
  const tot = {}, games = {};
  ppPool(pos, k).forEach(({ gs }) => { gs.forEach((g) => { if (g.season !== cur || Number(g.po)) return; const v = ppVal(g, k); if (typeof v !== 'number') return; tot[g.opp] = (tot[g.opp] || 0) + v; (games[g.opp] = games[g.opp] || new Set()).add(g.date); }); });
  const list = Object.keys(tot).map((t) => [t, tot[t] / games[t].size]).sort((a, b) => a[1] - b[1]);
  const out = Object.fromEntries(list.map(([t, v], i) => [t, { v, rk: i + 1 }]));
  dvpCache.set(ck, out); return out;
}

// ---- Types tab: where his points come from, and how the next opponent defends each type
function ppTypes(r, nx) {
  const P = pbPlayer(r.pid), D = nx && pbTeam(nx.opp);
  if (!P) return [el('div', 'No play-by-play data for him this season yet.', 'ppempty')];
  const T = [['ft', 'Free throws'], ['rim', 'At the rim (layups, dunks)'], ['pu', 'Pull-ups and step-backs'], ['cs', 'Catch and shoot'], ['flt', 'Floaters'], ['post', 'Post, hooks and fadeaways']];
  const tot = T.reduce((s, [k]) => s + P.pt[k], 0) || 1;
  const h = el('div', null, 'pph'); h.append(el('h3', 'Scoring type analysis'), el('span', ppCur() + ' season · ' + P.n + ' games', 'muted'));
  const t = el('table', null, 'pptbl types'); const hr = el('tr'); ['Type', 'Player points', (D ? nx.opp : 'Opp') + ' def rank'].forEach((x, i) => hr.append(el('th', x, i ? 'n' : ''))); t.append(hr);
  T.slice().sort((a, b) => P.pt[b[0]] - P.pt[a[0]]).forEach(([k, l]) => { const tr = el('tr'); const rk = D ? D.rk['pt_' + k] : null; const c = el('td', null, 'n'); c.append(el('span', rk ? '#' + rk : '–', 'pill rk ' + rkCls(rk))); tr.append(el('td', l), el('td', f1(P.pt[k] / P.n) + ' (' + Math.round((100 * P.pt[k]) / tot) + '%)', 'n'), c); t.append(tr); });
  return [h, t, el('p', 'Points per game from each type of scoring play this season, from ESPN play-by-play. Defence rank: points a game each defence allows from that type; #1 allows the fewest, so green (#21–30) is a soft matchup.', 'muted ppnote')];
}

// The matchup tile at the start of a strip opens that game's page (when the game is loaded).
const ppGameOf = (r, nx) => {
  if (!nx) return null;
  nx = { ...nx, day: String(nx.day || '').replace(/,/g, '').replace(/^(\w+) 0(\d) /, '$1 $2 ') };
  if (PM === 'nba') return nx.game ? { sp: 'nba', id: nx.id, day: nx.day } : null;
  if (AT.sp === 'nfl') {
    const day = (x) => String(x.kick).split(',')[0].replace(/^(\w+) 0(\d) /, '$1 $2 ');
    const g = rows('nflgames').find((x) => day(x) === nx.day && (x.home === r.team || x.away === r.team || x.home === nx.opp || x.away === nx.opp));
    return g ? { sp: 'nfl', id: g.id, day: nx.day } : null;
  }
  const day = (x) => String(x.time).split(',')[0].replace(/^(\w+) 0(\d) /, '$1 $2 ');
  const sim = (a, b) => { a = SSX.norm(a); b = SSX.norm(b); return !!a && !!b && (a === b || a.includes(b) || b.includes(a)); };
  const f = rows('fixtures').find((x) => day(x) === nx.day && (sim(x.home, nx.oppName) || sim(x.away, nx.oppName)));
  return f ? { sp: 'fb', id: f.id, day: nx.day } : null;
};
const ppMatchup = (r, nx, a, b) => {
  const g = ppGameOf(r, nx), m = el(g ? 'button' : 'div', null, 'ppmu' + (g ? ' go' : ''));
  m.append(a, el('span', nx.home ? 'vs' : '@'), b);
  if (g) { m.type = 'button'; m.title = 'Open game'; m.addEventListener('click', () => SSX.openGame(g.sp, g.id, g.day)); }
  return m;
};

// ---- Bottom strip: the players in his next game; tap one to switch, keeping the market.
dash.draw('ppstrip', (box) => {
  PM = 'nba';
  const r = PL.name && SSX.sec === 'player' && plRow(PL.name); if (!r) { box.replaceChildren(); return; }
  const nx = ppNext(r); const teams = nx ? [r.team, nx.opp] : [r.team];
  const k = PP.mk, cur = ppCur();
  const people = rows('pgl').filter((p) => teams.includes(p.team)).map((p) => { const gs = plGames(p).filter((g) => g.season === cur); return { p, n: gs.length, min: gs.length ? gs.reduce((s, g) => s + g.min, 0) / gs.length : 0 }; }).filter((x) => x.n >= 2 && x.min >= 18).sort((a, b) => (a.p.team === r.team ? 0 : 1) - (b.p.team === r.team ? 0 : 1) || b.min - a.min);
  if (!people.length) { box.replaceChildren(); return; }
  const sc = el('div', null, 'ppstrip');
  if (nx) sc.append(ppMatchup(r, nx, badge(r.team), badge(nx.opp)));
  people.forEach(({ p }) => {
    const b = el('button', null, 'ppchipp' + (p.pid === r.pid ? ' on' : '')); b.type = 'button';
    const gs = ppGames(p); const L = ppLine(p, gs, k);
    const nm = p.player.split(' '); const top = el('div', null, 't'); top.append(el('b', nm[0][0] + '. ' + nm.slice(1).join(' ')), el('span', p.team));
    const bot = el('div', null, 'l'); bot.append(el('span', ppBinary(k) ? 'Y/N' : String(L.v), 'v'), el('span', MK_SHORT[k], 'k'));
    b.append(top, bot); b.addEventListener('click', () => { if (p.pid !== r.pid) { PL.name = p.player; plDraw(); ppRedraw(); toView('view-player'); } });
    sc.append(b);
  });
  box.replaceChildren(sc);
  requestAnimationFrame(() => { const on = sc.querySelector('.on'); if (on) sc.scrollLeft = on.offsetLeft - 40; });
});

// ---- Splits tab (football and NFL): how he does against the line in each kind of game
function ppSplits(r, k, gs, L) {
  const cur = ppCur(), nx = ppNext(r);
  const all = gs.filter((g) => typeof ppVal(g, k) === 'number');
  const seasons = [...new Set(all.map((g) => g.season))].sort().reverse();
  const S = [['This season', all.filter((g) => g.season === cur)], ['Last season', all.filter((g) => g.season === seasons.find((x) => x < cur))], ['Last 5', all.slice(0, 5)], ['Last 10', all.slice(0, 10)],
    ['Home', all.filter((g) => g.ha === 'H')], ['Away', all.filter((g) => g.ha === 'A')], ['Team won', all.filter((g) => g.res === 'W')], ['Team lost', all.filter((g) => g.res === 'L')]];
  if (nx) S.push(['vs ' + nx.opp + ' (all seasons)', all.filter((g) => g.opp === nx.opp)]);
  const t = el('table', null, 'pptbl'); const hr = el('tr'); ['Split', 'Games', 'Avg', 'Over ' + L.v].forEach((x, i) => hr.append(el('th', x, i ? 'n' : ''))); t.append(hr);
  S.forEach(([l, list]) => { if (!list.length) return; const v = list.map((g) => ppVal(g, k)); const a = v.reduce((x, y) => x + y, 0) / v.length, o = v.filter((x) => x > L.v).length, pc = Math.round((100 * o) / v.length);
    const tr = el('tr'); const c = el('td', null, 'n'); c.append(el('span', pc + '% (' + o + '/' + v.length + ')', 'pill ' + (pc >= 60 ? 'up' : pc <= 40 ? 'dn' : ''))); tr.append(el('td', l), el('td', String(v.length), 'n'), el('td', f1(a), 'n'), c); t.append(tr); });
  const h = el('div', null, 'pph'); h.append(el('h3', MK_NAME[k] + ' splits'), el('span', 'against your line of ' + L.v, 'muted'));
  const w = el('div', null, 'scroll'); w.append(t);
  return [h, w, el('p', 'Every game on file (up to three seasons). Change the line with − / + or by dragging it on the graph.', 'muted ppnote')];
}
dash.draw('atstrip', (box) => {
  PM = 'at';
  try {
    const r = SSX.sec === 'athlete' && atRow(); if (!r) { box.replaceChildren(); return; }
    const nx = ppNext(r), teams = nx ? [r.team, nx.opp] : [r.team], cur = ppCur(), k = PP.amk[AT.sp];
    if (!k) { box.replaceChildren(); return; }
    const skill = AT.sp === 'nfl' ? ['QB', 'RB', 'WR', 'TE'] : null;
    const people = rows(AT_DS[AT.sp]).filter((p) => teams.includes(p.team) && (!skill || skill.includes(p.pos))).map((p) => { const gs = atGames(p).filter((g) => g.season === cur); const v = gs.map((g) => ppVal(g, k)).filter((x) => typeof x === 'number'); return { p, n: gs.length, a: v.length ? v.reduce((x, y) => x + y, 0) / v.length : 0 }; })
      .filter((x) => x.n >= 2 && x.a > 0).sort((a, b) => (a.p.team === r.team ? 0 : 1) - (b.p.team === r.team ? 0 : 1) || b.a - a.a).slice(0, 18);
    if (!people.some((x) => x.p.pid === r.pid)) people.unshift({ p: r });
    const sc = el('div', null, 'ppstrip');
    if (nx) sc.append(ppMatchup(r, nx, bdX(r.team), bdX(nx.opp)));
    people.forEach(({ p }) => {
      const b = el('button', null, 'ppchipp' + (p.pid === r.pid ? ' on' : '')); b.type = 'button';
      const L = ppLine(p, atGames(p), k); const nm = p.player.split(' ');
      const top = el('div', null, 't'); top.append(el('b', nm.length > 1 ? nm[0][0] + '. ' + nm.slice(1).join(' ') : p.player), el('span', p.team));
      const bot = el('div', null, 'l'); bot.append(el('span', String(L.v), 'v'), el('span', MK_SHORT[k], 'k'));
      b.append(top, bot); b.addEventListener('click', () => { if (p.pid !== r.pid) openAthlete(AT.sp, p.pid); });
      sc.append(b);
    });
    box.replaceChildren(sc);
    requestAnimationFrame(() => { const on = sc.querySelector('.on'); if (on) sc.scrollLeft = on.offsetLeft - 40; });
  } finally { PM = 'nba'; }
});

// ---- Value board (home page): bets where our chance beats the best Australian bookmaker price.
const VB = { sp: 'all', all: false };
dash.draw('valboard', (box) => {
  const g = dash.data('odds');
  if (g.status !== 'ok' || !g.data.length) { box.replaceChildren(el('p', g.status === 'loading' ? 'Loading odds…' : 'No bookmaker odds loaded yet. They load in the daily run once the odds service is connected.', 'vbnone')); return; }
  const rowsAll = g.data.filter((r) => new Date(r.kick).getTime() > Date.now() - 2 * 3600000);
  const pass = (r) => (VB.all ? r.our >= 55 && r.edge >= 2 : r.our >= 65 && r.edge >= 5);
  const list = rowsAll.filter((r) => (VB.sp === 'all' || r.sp === VB.sp) && pass(r)).sort((a, b) => b.edge - a.edge).slice(0, 30);
  const bar = el('div', null, 'vbbar');
  [['all', 'All'], ['fb', 'Football'], ['nba', 'NBA'], ['nfl', 'NFL']].forEach(([k, l]) => { const n = rowsAll.filter((r) => (k === 'all' || r.sp === k) && pass(r)).length; const b = el('button', l + ' (' + n + ')', VB.sp === k ? 'on' : ''); b.type = 'button'; b.addEventListener('click', () => { VB.sp = k; dash.draw('valboard'); }); bar.append(b); });
  const tg = el('button', VB.all ? 'Strong edges only' : 'Show smaller edges too', 'vbtog'); tg.type = 'button'; tg.addEventListener('click', () => { VB.all = !VB.all; dash.draw('valboard'); }); bar.append(tg);
  const out = [bar];
  if (!list.length) out.push(el('p', 'Nothing clears the bar right now' + (VB.all ? '.' : ': try "Show smaller edges too".'), 'vbnone'));
  list.forEach((r) => {
    const d = el('div', null, 'vbr');
    const when = new Date(r.kick).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney' });
    const l = el('div', null, 'l'); l.append(el('b', r.pick), el('span', r.market + ' · ' + r.match), el('small', r.league + ' · ' + when));
    const m = el('div', null, 'm'); m.append(el('span', 'Ours ' + Math.round(r.our) + '%', 'us'), el('span', '@ ' + r.price.toFixed(2) + ' = ' + Math.round(r.implied) + '%', 'bk'), el('small', r.book + (r.books > 1 ? ' · best of ' + r.books + ' (avg ' + r.avg.toFixed(2) + ')' : '')));
    const e = el('div', '+' + r.edge.toFixed(1), 'e ' + (r.edge >= 10 ? 'hi' : r.edge >= 5 ? 'md' : 'lo'));
    d.append(l, m, e); out.push(d);
  });
  box.replaceChildren(...out);
});

// ---- NBA game page header: same layout as football and NFL (logos, names, records, time, pick).
dash.draw('nbahd', (box) => {
  const id = SSX.current; const g = id && rows('games').find((x) => x.id === id);
  if (!g) { box.replaceChildren(); return; }
  const p = rows('pred').find((x) => x.id === id) || {};
  const recOf = (c) => (rows('teams').find((t) => t.game === id && t.team === c) || {}).record || '';
  const [an, hn] = String(g.matchup || '').split(' @ ');
  const side = (code, name) => { const d = el('div', null, 'tm'); d.append(badge(code), el('b', name || code), el('span', recOf(code), 'muted')); return d; };
  const mid = el('div', null, 'mid');
  mid.append(el('span', 'NBA', 'muted'), el('strong', String(g.time || '').toLowerCase().replace(' ', ' ')), el('span', g.date || '', 'muted'));
  if (p.ml_pick) mid.append(el('span', p.ml_pick + ' · ' + p.ml_final_prob + '%', 'muted'));
  const hd = el('div', null, 'hd'); hd.append(side(g.away, an), mid, side(g.home, hn));
  box.replaceChildren(hd);
});
