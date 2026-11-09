// Builds one NBA slate (one Sydney day) the way Run 3 does by hand: games, teams, log, ladder,
// notes, lineups, pred and plog rows for every game, from ESPN (schedule, DraftKings lines, last
// box scores) and our own game logs (pgl) and injury list (troster).
// Usage: node scripts/nba-slate.js 20261104        (the US date of the games; Sydney is the next day)
// Run fetch-gamelogs.js and fetch-rosters.js first. Rows for these game ids are replaced; others kept.
//
// Method (RUNBOOK "Pick methods", NBA): projected points = average of own scoring and opponent
// allowed, +2 home edge (±1 each side), recent form (30% of last-5 margin minus season margin),
// rest (-2 on the second night of a back-to-back) and injuries (players Out lose 45% of their
// points, Doubtful 75% of that, Questionable/Day-To-Day 25%). Margin and total: 55% model + 45%
// market; small samples per the safeguards. Win chance: 60% normal cdf(margin / 12) + 40% price.
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'public', 'data');
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/';
const US_DATE = process.argv[2];
if (!/^\d{8}$/.test(US_DATE || '')) { console.error('Usage: node scripts/nba-slate.js YYYYMMDD (US date)'); process.exit(1); }
const CODE = { GS: 'GSW', NO: 'NOP', NY: 'NYK', SA: 'SAS', UTAH: 'UTA', WSH: 'WAS' };
const code = (a) => CODE[a] || a;
const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f + '.json'), 'utf8')); } catch (e) { return []; } };
const write = (f, d) => fs.writeFileSync(path.join(DATA, f + '.json'), JSON.stringify(d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(url, tries = 4) { for (let i = 0; i < tries; i++) { try { const r = await fetch(url, { headers: { 'User-Agent': 'StatSniper/1.0' } }); if (r.status === 404) return null; if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } catch (e) { if (i === tries - 1) { console.warn('failed', url, e.message); return null; } await sleep(600 * 2 ** i); } } }
const r1 = (x) => Math.round(x * 10) / 10;
const sydKey = (iso) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', weekday: 'short', day: 'numeric', month: 'short' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value])); return `${p.weekday} ${p.day} ${p.month}`; };
const sydTime = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: 'Australia/Sydney', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));
const checkedAt = () => new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()) + ' AEDT';
const phi = (z) => { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };
const implied = (ml) => (ml == null ? null : ml > 0 ? 100 / (ml + 100) : -ml / (-ml + 100));
// Highest x.5 line cleared over by at least share of values / lowest x.5 line cleared under.
const overLine = (vals, share) => { const s = vals.slice().sort((a, b) => a - b); if (!s.length) return null; const k = Math.ceil(s.length * share); const v = s[s.length - k]; return Math.floor(v) - 0.5 + (Number.isInteger(v) ? 0 : 0.5); };
const underLine = (vals, share) => { const s = vals.slice().sort((a, b) => b - a); if (!s.length) return null; const k = Math.ceil(s.length * share); const v = s[s.length - k]; return Math.floor(v) + 0.5; };
const hitOver = (vals, line) => vals.filter((v) => v > line).length + '/' + vals.length;
const hitUnder = (vals, line) => vals.filter((v) => v < line).length + '/' + vals.length;

(async () => {
  const pgl = read('pgl'), troster = read('troster'), AU = read('odds');
  const sb = await getJson(`${SITE}scoreboard?dates=${US_DATE}`);
  const events = ((sb && sb.events) || []).filter((e) => e.status && e.status.type && e.status.type.state === 'pre');
  if (!events.length) { console.error('No upcoming games on ' + US_DATE); process.exit(1); }
  const cur = pgl.reduce((m, r) => { const s = String(r.g || '').split(',')[1] || ''; return s > m ? s : m; }, '');
  // ---- team game lists from player logs (regular season, this season)
  const tg = {};
  for (const r of pgl) for (const s of String(r.g || '').split(';')) {
    const a = s.split(','); if (a[1] !== cur || Number(a[21]) === 1 || !a[2]) continue;
    const t = a[2], k = a[0]; tg[t] = tg[t] || new Map(); if (tg[t].has(k)) continue;
    const [pf, pa] = a[6].split('-').map(Number); tg[t].set(k, { date: k, opp: a[3], ha: a[4], pf, pa, res: a[5] });
  }
  const games = (t) => [...((tg[t] && tg[t].values()) || [])].sort((a, b) => (a.date < b.date ? -1 : 1));
  const avg = (l, f) => (l.length ? l.reduce((s, x) => s + f(x), 0) / l.length : 0);
  const all30 = Object.keys(tg).filter((t) => t.length <= 4);
  const rankBy = (f, asc) => Object.fromEntries(all30.map((t) => [t, f(games(t))]).sort((a, b) => (asc ? a[1] - b[1] : b[1] - a[1])).map(([t], i) => [t, i + 1]));
  const offRank = rankBy((g) => avg(g, (x) => x.pf), false), defRank = rankBy((g) => avg(g, (x) => x.pa), true);
  const rec = (l) => l.filter((x) => x.res === 'W').length + '-' + l.filter((x) => x.res === 'L').length;
  // ---- per-player points this season (for injuries)
  const ppg = {}; for (const r of pgl) { const gs = String(r.g || '').split(';').map((s) => s.split(',')).filter((a) => a[1] === cur && Number(a[7]) > 0); if (gs.length) ppg[r.pid] = { pts: avg(gs, (a) => Number(a[8])), min: avg(gs, (a) => Number(a[7])), n: gs.length, name: r.player, team: r.team, dates: new Set(gs.map((a) => a[0])) }; }
  const injOf = (team) => { const t = troster.find((x) => x.sp === 'nba' && x.code === team); return (t && t.inj) || []; };
  const injW = (st) => (/^out$/i.test(st) ? 1 : /doubt/i.test(st) ? 0.75 : /question|day/i.test(st) ? 0.25 : 0);

  const out = { games: [], teams: [], log: [], ladder: [], notes: [], lineups: [], pred: [], plog: [] };
  let day = '';
  for (const e of events) {
    const c = e.competitions[0], H = c.competitors.find((x) => x.homeAway === 'home'), A = c.competitors.find((x) => x.homeAway === 'away');
    const hc = code(H.team.abbreviation), ac = code(A.team.abbreviation), id = `${ac}-${hc}`; day = sydKey(e.date);
    const o = (c.odds || [])[0] || {};
    const det = String(o.details || ''); const fav = det && det !== 'EVEN' ? code(det.split(' ')[0]) : hc; const spread = Math.abs(Number(String(det).split(' ')[1]) || 0);
    const total = o.overUnder != null ? Number(o.overUnder) : null;
    const mlv = (side) => { const m = o.moneyline && o.moneyline[side]; const v = m && ((m.close && m.close.odds) || (m.open && m.open.odds)); return v != null && v !== '' && v !== 'OFF' ? Number(String(v).replace('+', '')) : null; };
    const mlH = mlv('home'), mlA = mlv('away');
    const fmtML = (v) => (v == null ? '' : v > 0 ? '+' + v : String(v));
    const ml = mlH != null && mlA != null ? (mlH < mlA ? `${hc} ${fmtML(mlH)} / ${ac} ${fmtML(mlA)}` : `${ac} ${fmtML(mlA)} / ${hc} ${fmtML(mlH)}`) : 'not posted';
    const gH = games(hc), gA = games(ac), totals = [...gH, ...gA].map((x) => x.pf + x.pa);
    const T = total ?? Math.round(avg(totals.length ? totals.map((v) => ({ v })) : [{ v: 225 }], (x) => x.v) * 2) / 2; // no posted total: their average total
    const g = { id, away: ac, home: hc, matchup: `${A.team.name} @ ${H.team.name}`, time: sydTime(e.date), total: T, fav, spread, ml,
      comb_over: totals.filter((v) => v > T).length, comb_n: totals.length, comb_under: totals.filter((v) => v < T).length,
      over75: overLine(totals, 0.75), over75_hit: '', under75: underLine(totals, 0.75), under75_hit: '', over100: overLine(totals, 1), over100_hit: '', under100: underLine(totals, 1), under100_hit: '',
      min_total: Math.min(...totals), max_total: Math.max(...totals), date: day };
    ['over75', 'over100'].forEach((k) => { g[k + '_hit'] = g[k] == null ? '' : hitOver(totals, g[k]); }); ['under75', 'under100'].forEach((k) => { g[k + '_hit'] = g[k] == null ? '' : hitUnder(totals, g[k]); });
    out.games.push(g);
    for (let ln = T - 15; ln <= T + 15; ln += 5) { const ao = gA.filter((x) => x.pf + x.pa > ln).length, ho = gH.filter((x) => x.pf + x.pa > ln).length, n = gA.length + gH.length; out.ladder.push({ game: id, line: ln, away_over: ao, away_n: gA.length, home_over: ho, home_n: gH.length, over_pct: n ? Math.round((100 * (ao + ho)) / n) : 0, under_pct: n ? Math.round((100 * (n - ao - ho)) / n) : 0 }); }
    // team rows
    const teamRow = (t, name, role, l) => {
      const hm = l.filter((x) => x.ha === 'H'), aw = l.filter((x) => x.ha === 'A'), tots = l.map((x) => x.pf + x.pa), pts = l.map((x) => x.pf);
      const myLine = fav === t ? -spread : spread; const imp = r1(T / 2 - myLine / 2);
      const row = { game: id, team: t, name, role, record: rec(l), ppg: r1(avg(l, (x) => x.pf)), opp_ppg: r1(avg(l, (x) => x.pa)), diff: r1(avg(l, (x) => x.pf - x.pa)), avg_total: r1(avg(l, (x) => x.pf + x.pa)), t_over: tots.filter((v) => v > T).length, t_under: tots.filter((v) => v < T).length, n: l.length,
        home_rec: rec(hm), home_pf: r1(avg(hm, (x) => x.pf)), home_pa: r1(avg(hm, (x) => x.pa)), away_rec: rec(aw), away_pf: r1(avg(aw, (x) => x.pf)), away_pa: r1(avg(aw, (x) => x.pa)),
        tot_over75: overLine(tots, 0.75), tot_under75: underLine(tots, 0.75), tot_over100: overLine(tots, 1), tot_under100: underLine(tots, 1),
        imp, p_over: pts.filter((v) => v > imp).length, p_under: pts.filter((v) => v < imp).length, p_min: Math.min(...pts), p_max: Math.max(...pts),
        p_over75: overLine(pts, 0.75), p_under75: underLine(pts, 0.75), p_over100: overLine(pts, 1), p_under100: underLine(pts, 1),
        spread_line: Math.abs(spread), cover: l.filter((x) => x.pf - x.pa + myLine > 0).length, cover_n: l.length, off_rank: offRank[t], def_rank: defRank[t] };
      ['tot_over75', 'tot_over100'].forEach((k) => { row[k + '_hit'] = row[k] == null ? '' : hitOver(tots, row[k]); }); ['tot_under75', 'tot_under100'].forEach((k) => { row[k + '_hit'] = row[k] == null ? '' : hitUnder(tots, row[k]); });
      ['p_over75', 'p_over100'].forEach((k) => { row[k + '_hit'] = row[k] == null ? '' : hitOver(pts, row[k]); }); ['p_under75', 'p_under100'].forEach((k) => { row[k + '_hit'] = row[k] == null ? '' : hitUnder(pts, row[k]); });
      return row;
    };
    const tA = teamRow(ac, A.team.name, 'Away', gA), tH = teamRow(hc, H.team.name, 'Home', gH);
    out.teams.push(tA, tH);
    [[ac, gA], [hc, gH]].forEach(([t, l]) => l.forEach((x, i) => out.log.push({ key: `${id}-${t}-${i}`, game: id, team: t, opp: x.opp, venue: x.ha === 'H' ? 'Home' : 'Away', pf: x.pf, pa: x.pa, total: x.pf + x.pa, result: x.res })));
    // injuries and lineups (last game's starting five)
    const injTxt = (t) => injOf(t).filter((x) => injW(x[3]) > 0).map((x) => `${x[1]} (${x[3]})`).join('; ') || 'None listed';
    // A new absence only: a regular (half the team's games) who played in at least one of its last three games.
    // Longer absences are already in the team's recent results. Capped at 8 points a team.
    const injPts = (t) => { const last3 = games(t).slice(-3).map((x) => x.date), n = games(t).length; return Math.min(8, injOf(t).reduce((s, x) => { const p = ppg[String(x[0])]; return s + (p && p.team === t && p.n >= n * 0.5 && last3.some((d) => p.dates.has(d)) ? injW(x[3]) * p.pts * 0.35 : 0); }, 0)); };
    for (const [t, tm, side] of [[ac, A, 'Away'], [hc, H, 'Home']]) {
      let starters = '', src = '';
      const sch = await getJson(`${SITE}teams/${tm.team.id}/schedule`);
      const last = ((sch && sch.events) || []).filter((x) => x.competitions[0].status.type.completed).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
      if (last) {
        const s = await getJson(`${SITE}summary?event=${last.id}`);
        const tp = s && (s.boxscore.players || []).find((x) => x.team.id === String(tm.team.id));
        const st = tp && tp.statistics[0] && tp.statistics[0].athletes.filter((a) => a.starter).map((a) => a.athlete.displayName);
        if (st && st.length) { const outNames = injOf(t).filter((x) => injW(x[3]) >= 0.75).map((x) => x[1]); starters = st.map((n) => n + (outNames.includes(n) ? ' (Out)' : injOf(t).some((x) => x[1] === n && injW(x[3]) > 0) ? ' (Q)' : '')).join(' · '); src = `Last game's starting five (ESPN box score, ${sydKey(last.date)}) plus ESPN injuries feed.`; }
      }
      out.lineups.push({ key: `${id}-${t}`, game: id, team: t, side, status: 'Projected', starters: starters || 'Not found', out: injTxt(t), source: src || 'ESPN box score not available', checked: checkedAt(), change: 'Projected only: the final five is announced about 30 minutes before tip.' });
    }
    out.notes.push({ key: `${id}-Lines-1`, game: id, kind: 'Lines', text: `${fav} -${spread}, total ${T}, ${ml} (ESPN, DraftKings). Checked ${checkedAt()}.` },
      { key: `${id}-Injuries / lineups-2`, game: id, kind: 'Injuries / lineups', text: `${ac}: ${injTxt(ac)}. ${hc}: ${injTxt(hc)}. Source: ESPN injuries feed. Lineups projected from each team's last game.` },
      { key: `${id}-Props-3`, game: id, kind: 'Props', text: 'No player prop lines used.' });
    // plog: rotation players with status
    for (const t of [ac, hc]) {
      const opp = t === ac ? hc : ac;
      Object.entries(ppg).filter(([, p]) => p.team === t && p.n >= 3 && p.min >= 15).forEach(([pid, p]) => {
        const inj = injOf(t).find((x) => String(x[0]) === pid);
        const st = inj ? (/^out$/i.test(inj[3]) ? 'Out' : 'Questionable') : 'Available';
        const r = pgl.find((x) => x.pid === pid); const vs = String(r.g || '').split(';').map((s) => s.split(',')).filter((a) => a[3] === opp && Number(a[7]) > 0);
        const row = { key: `${id}-${p.name}`, game: id, team: t, opp, player: p.name, status: st, n: vs.length, mpg: r1(p.min) };
        [['pts', 8], ['reb', 9], ['ast', 10], ['tpm', 11]].forEach(([k, i]) => { const v = vs.map((a) => Number(a[i])); row[k + '_avg'] = v.length ? r1(avg(v.map((x) => ({ x })), (q) => q.x)) : null; row[k + '_vals'] = v.join(', '); row[k + '_line'] = null; row[k + '_hit'] = null; row[k + '_floor'] = null; });
        const pra = vs.map((a) => Number(a[8]) + Number(a[9]) + Number(a[10])); row.pra_avg = pra.length ? r1(pra.reduce((s, x) => s + x, 0) / pra.length) : null; row.pra_vals = pra.join(', '); row.pra_line = null; row.pra_hit = null; row.pra_floor = null;
        out.plog.push(row);
      });
    }
    // ---- prediction
    const l5 = (l) => l.slice(-5);
    const formAdj = 0.3 * ((avg(l5(gH), (x) => x.pf - x.pa) - avg(gH, (x) => x.pf - x.pa)) - (avg(l5(gA), (x) => x.pf - x.pa) - avg(gA, (x) => x.pf - x.pa)));
    const prevDay = (d) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };
    const usDay = `${US_DATE.slice(0, 4)}-${US_DATE.slice(4, 6)}-${US_DATE.slice(6, 8)}`;
    const b2b = (l) => l.some((x) => x.date === prevDay(usDay));
    const restH = b2b(gH) ? -2 : 0, restA = b2b(gA) ? -2 : 0;
    const iH = injPts(hc), iA = injPts(ac);
    const ptsH = (tH.ppg + tA.opp_ppg) / 2 + 1 + formAdj / 2 + restH - iH, ptsA = (tA.ppg + tH.opp_ppg) / 2 - 1 - formAdj / 2 + restA - iA;
    const modelMargin = ptsH - ptsA, modelTotal = ptsH + ptsA;
    let mH = implied(mlH), mA = implied(mlA); if (mH != null && mA != null) { const s = mH + mA; mH /= s; mA /= s; }
    const hasLine = !!det && det !== 'EVEN' && Number.isFinite(Number(String(det).split(' ')[1]));
    let posted = hasLine ? (fav === hc ? spread : -spread) : (det === 'EVEN' ? 0 : null), lineSrc = 'ESPN/DraftKings';
    // No ESPN line: use the Australian bookmakers' consensus spread and moneyline (odds.json from fetch-odds.js).
    const au = AU.filter((o) => o.game === id);
    if (posted == null) { const sp = au.find((o) => o.market === 'Spread' && o.pick.startsWith(H.team.name + ' ')); if (sp) { posted = -Number(sp.point); lineSrc = 'Australian bookmakers (no ESPN line yet)'; } }
    if (mH == null && au.length) { const w = (nm) => au.find((o) => o.market === 'Winner' && o.pick === nm + ' win'); const wh = w(H.team.name), wa = w(A.team.name); if (wh && wa) { const ih = 1 / wh.price, ia = 1 / wa.price; mH = ih / (ih + ia); mA = ia / (ih + ia); } }
    const minN = Math.min(gH.length, gA.length);
    const small = posted != null && minN < 8 && Math.abs(modelMargin - posted) > 5;
    const wM = posted == null ? 1 : small ? 0.3 : 0.55, wT = total == null ? 1 : minN < 6 ? 0.25 : 0.55;
    const margin = wM * modelMargin + (1 - wM) * (posted ?? 0), projTotal = wT * modelTotal + (1 - wT) * T;
    const lean = minN < 6 || total == null ? 'Coin toss' : modelTotal - T >= 5 ? 'Lean over' : T - modelTotal >= 5 ? 'Lean under' : 'Coin toss';
    const modelH = phi(margin / 12), finalH = mH != null ? 0.6 * modelH + 0.4 * mH : modelH;
    const pickHome = finalH >= 0.5, pick = pickHome ? hc : ac, pickName = pickHome ? H.team.name : A.team.name;
    const fp = Math.round(100 * (pickHome ? finalH : 1 - finalH)), mp = Math.round(100 * (pickHome ? modelH : 1 - modelH)), kp = mH == null ? null : Math.round(100 * (pickHome ? mH : 1 - mH));
    const agree = posted == null ? true : (margin > 0) === (posted > 0) || posted === 0;
    const mlConf = fp >= 68 && agree ? 'High' : fp >= 58 ? 'Medium' : 'Low';
    const ptsConf = Math.abs(margin) >= 8 && agree ? 'High' : Math.abs(margin) >= 4 ? 'Medium' : 'Low';
    const rank = { High: 2, Medium: 1, Low: 0 }, comb = ['Low', 'Medium', 'High'][Math.min(rank[mlConf], rank[ptsConf])];
    const edge = kp == null ? 0 : mp - kp;
    const sH = Math.round((projTotal + margin) / 2), sA = Math.round((projTotal - margin) / 2);
    const why = [posted == null ? `No line posted yet: model only (margin ${modelMargin >= 0 ? '+' : ''}${r1(modelMargin)} home). Re-run when lines are up.` : `Model margin ${modelMargin >= 0 ? '+' : ''}${r1(modelMargin)} (home) vs market ${posted >= 0 ? '+' : ''}${posted}; ${Math.round(wM * 100)}% model + ${Math.round((1 - wM) * 100)}% market${small ? ' (small-sample safeguard: either team under 8 games and the model more than 5 points off the market)' : ''}.`,
      `Model total ${r1(modelTotal)} vs posted ${T}: ${lean === 'Coin toss' ? (minN < 6 ? 'under 6 games for a team, so a Coin toss' : 'gap under 5 points, so a Coin toss') : lean + ' (gap of 5+ points)'}.`,
      Math.abs(formAdj) >= 0.5 ? `Recent form (last 5 vs season margin) moves the margin by ${formAdj >= 0 ? '+' : ''}${r1(formAdj)}.` : '',
      restH || restA ? `Rest: ${[restH ? hc : '', restA ? ac : ''].filter(Boolean).join(' and ')} on the second night of a back-to-back (-2).` : '',
      iH || iA ? `Injuries (new absences only, ESPN feed): ${hc} -${r1(iH)}, ${ac} -${r1(iA)} points.` : 'No injury adjustment (no regular newly out; longer absences are already in recent results).',
      posted != null && (!pickHome && posted > 0 || pickHome && posted < 0) ? 'Underdog pick: our blend has them above 50%.' : '',
      iH || iA ? '' : '',
      `Lines: ${lineSrc}. Lineups projected from each team's last game. Built ${checkedAt()}.`].filter(Boolean).join(' ');
    out.pred.push({ id, matchup: g.matchup, winner: margin >= 0 ? hc : ac, margin: r1(Math.abs(margin)), score: `${ac} ${sA} - ${hc} ${sH}`, proj_total: r1(projTotal), posted_total: T, total_lean: lean,
      alt_line: lean === 'Lean over' ? (g.over75 != null ? 'o' + g.over75 + ' (' + g.over75_hit + ')' : '') : lean === 'Lean under' ? (g.under75 != null ? 'u' + g.under75 + ' (' + g.under75_hit + ')' : '') : '',
      confidence: ptsConf, model_margin: r1(modelMargin), model_total: r1(modelTotal), posted_margin: posted, reasoning: why,
      ml_pick: pick, ml_price: `${pick} ${fmtML(pickHome ? mlH : mlA)}`, ml_market_prob: kp, ml_model_prob: mp, ml_final_prob: fp, ml_conf: mlConf, ml_agree: agree ? 'Yes' : 'No', ml_edge: edge,
      ml_value: edge >= 3 ? 'Model likes it more than the price' : edge <= -3 ? 'Price is better than my model' : 'Model and price agree',
      ml_records: `${pick} ${rec(pickHome ? gH : gA)} (${pickHome ? 'home ' + tH.home_rec : 'away ' + tA.away_rec}); opponent ${pickHome ? ac : hc} ${rec(pickHome ? gA : gH)}`, combined_conf: comb,
      underdog: posted != null && ((pickHome && posted < 0) || (!pickHome && posted > 0)), pickName });
  }
  // ---- merge: replace rows for these game ids, keep the rest
  const ids = new Set(out.games.map((g) => g.id));
  const merge = (name, idKey) => { const old = read(name).filter((r) => !(ids.has(r[idKey]) && (name !== 'games' || r.date === day))); write(name, [...old.filter((r) => name === 'games' || !ids.has(r[idKey])), ...out[name]]); };
  merge('games', 'id'); merge('pred', 'id');
  ['teams', 'log', 'ladder', 'notes', 'lineups', 'plog'].forEach((n) => merge(n, 'game'));
  write('schedule', read('schedule').filter((s) => !(s.sport === 'nba' && s.date === day)));
  out.pred.forEach((p) => delete p.pickName);
  write('pred', [...read('pred').filter((r) => !ids.has(r.id)), ...out.pred]);
  console.log(`${day}: ${out.games.length} games. ` + out.pred.map((p) => `${p.id} ${p.ml_pick} ${p.ml_final_prob}% (${p.combined_conf}${p.underdog ? ', underdog' : ''}), ${p.total_lean}`).join('; '));
})().catch((e) => { console.error(e); process.exit(1); });
