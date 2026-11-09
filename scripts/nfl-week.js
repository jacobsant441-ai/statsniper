// NFL: builds the coming week (ESPN's current scoreboard week) with the NFL method and refreshes the
// team table. Writes public/data/nflgames.json (replaced with this week's games) and nfltable.json.
// nflinfo.json keeps its rich rows for games it already has; new games get a basic row from the table.
//
// NFL method (RUNBOOK): model score = each side's points per game blended with what the other side
// allows (home/away splits), small home edge. Final spread and total: 35% model, 65% bookmaker line.
// Win chance: 40% model, 60% moneyline price (margin removed). Confidence High at 68%+ with model and
// market agreeing on the winner, Medium at 58%+. Total lean when the model is 3+ points off the posted
// total, else 'Coin toss'.
// Usage: node scripts/nfl-week.js
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'public', 'data');
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/';
const CODE = { JAX: 'JAC', LAR: 'LA', WSH: 'WAS' };
const HOME_EDGE = 1.5;
const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch (e) { return []; } };
const write = (f, d) => fs.writeFileSync(path.join(DATA, f), JSON.stringify(d));
async function getJson(url) {
  for (let i = 0; i < 4; i++) {
    try { const r = await fetch(url, { headers: { 'User-Agent': 'StatSniper/1.0' } }); if (r.ok) return await r.json(); } catch (e) { /* retry */ }
    await new Promise((res) => setTimeout(res, 500 * (i + 1)));
  }
  throw new Error('failed: ' + url);
}
const r1 = (x) => Math.round(x * 10) / 10;
const code = (a) => CODE[a] || a;
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const phi = (z) => { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2); const q = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - q : q; };
const implied = (ml) => (ml == null || isNaN(ml) ? null : ml > 0 ? 100 / (ml + 100) : -ml / (-ml + 100));
const kickText = (iso) => { const d = new Date(iso); const p = Object.fromEntries(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(d).map((x) => [x.type, x.value])); return `${p.weekday} ${p.day} ${p.month}, ${p.hour}:${p.minute}${String(p.dayPeriod).toLowerCase()}`; };
const slot = (iso) => { const d = new Date(iso); const et = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long', hour: 'numeric', hour12: false }).formatToParts(d); const wd = et.find((x) => x.type === 'weekday').value, h = Number(et.find((x) => x.type === 'hour').value); if (wd === 'Thursday') return ['Thursday Night', 'Thursday Night Football']; if (wd === 'Monday') return ['Monday Night', 'Monday Night Football']; if (wd === 'Sunday' && h >= 19) return ['Sunday Night', 'Sunday Night Football']; if (wd === 'Sunday' && h < 12) return ['Sunday Morning', 'International Series']; if (wd === 'Sunday' && h >= 16) return ['Sunday Late', 'Sunday Late Window']; return [wd, wd === 'Sunday' ? 'Sunday Early Window' : wd]; };

(async () => {
  const sb = await getJson(`${SITE}scoreboard`);
  const season = (sb.season && sb.season.year) || new Date().getFullYear();
  const events = (sb.events || []).filter((e) => e.competitions[0].status.type.state === 'pre');
  // Every team's finished regular-season games
  const teamsR = await getJson(`${SITE}teams`);
  const teams = teamsR.sports[0].leagues[0].teams.map((t) => t.team);
  const games = {};
  for (const t of teams) {
    const s = await getJson(`${SITE}teams/${t.id}/schedule?season=${season}&seasontype=2`).catch(() => null);
    games[code(t.abbreviation)] = ((s && s.events) || []).filter((e) => e.competitions[0].status.type.completed).map((e) => {
      const c = e.competitions[0], me = c.competitors.find((x) => x.team.id === t.id), op = c.competitors.find((x) => x.team.id !== t.id);
      const sc = (x) => Number(x.score && typeof x.score === 'object' ? x.score.value : x.score);
      return { ev: e.id, date: e.date, home: me.homeAway === 'home', neutral: !!c.neutralSite, pf: sc(me), pa: sc(op), opp: code(op.team.abbreviation) };
    }).sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  // Team table
  const rec = (l) => { const w = l.filter((g) => g.pf > g.pa).length, t = l.filter((g) => g.pf === g.pa).length; return `${w}-${l.length - w - t}` + (t ? `-${t}` : ''); };
  const table = teams.map((t) => {
    const c = code(t.abbreviation), l = games[c] || [], h = l.filter((g) => g.home && !g.neutral), a = l.filter((g) => !g.home && !g.neutral), l3 = l.slice(-3), tot = l.map((g) => g.pf + g.pa);
    let streak = ''; for (let i = l.length - 1; i >= 0; i--) { const r = l[i].pf > l[i].pa ? 'W' : l[i].pf < l[i].pa ? 'L' : 'T'; if (!streak) streak = r + '1'; else if (streak[0] === r) streak = r + (Number(streak.slice(1)) + 1); else break; }
    return { team: c, name: t.displayName, played: l.length, record: rec(l), home_rec: rec(h), away_rec: rec(a), pf: r1(avg(l.map((g) => g.pf)) || 0), pa: r1(avg(l.map((g) => g.pa)) || 0), margin: r1((avg(l.map((g) => g.pf - g.pa)) || 0)),
      home_pf: r1(avg(h.map((g) => g.pf)) || 0), home_pa: r1(avg(h.map((g) => g.pa)) || 0), away_pf: r1(avg(a.map((g) => g.pf)) || 0), away_pa: r1(avg(a.map((g) => g.pa)) || 0),
      l3: l3.map((g) => (g.pf > g.pa ? 'W' : g.pf < g.pa ? 'L' : 'T')).reverse().join(''), l3_pf: r1(avg(l3.map((g) => g.pf)) || 0), l3_pa: r1(avg(l3.map((g) => g.pa)) || 0), streak,
      avg_total: r1(avg(tot) || 0), o40: tot.filter((x) => x > 40).length, o45: tot.filter((x) => x > 45).length, o50: tot.filter((x) => x > 50).length, u20: l.filter((g) => g.pf < 20).length, p30: l.filter((g) => g.pf >= 30).length,
      best: Math.max(0, ...l.map((g) => g.pf)), last: l.slice(-3).reverse().map((g) => `${g.home ? 'vs' : '@'} ${g.opp} ${g.pf > g.pa ? 'W' : g.pf < g.pa ? 'L' : 'T'} ${g.pf}-${g.pa}`) };
  });
  const T = Object.fromEntries(table.map((t) => [t.team, t]));
  // This week's games
  const out = [];
  for (const e of events) {
    const c = e.competitions[0], H = c.competitors.find((x) => x.homeAway === 'home'), A = c.competitors.find((x) => x.homeAway === 'away');
    const hc = code(H.team.abbreviation), ac = code(A.team.abbreviation), th = T[hc], ta = T[ac]; if (!th || !ta) continue;
    const neutral = !!c.neutralSite;
    // Model: home team's scoring (at home) with the away side's conceding (away), and the reverse
    const pick2 = (x, y) => (x && y ? (x + y) / 2 : x || y || 21);
    const model_home = r1(pick2(neutral ? th.pf : th.home_pf || th.pf, neutral ? ta.pa : ta.away_pa || ta.pa) + (neutral ? 0 : HOME_EDGE / 2));
    const model_away = r1(pick2(neutral ? ta.pf : ta.away_pf || ta.pf, neutral ? th.pa : th.home_pa || th.pa) - (neutral ? 0 : HOME_EDGE / 2));
    const model_margin = r1(model_home - model_away), model_total = r1(model_home + model_away);
    const o = (c.odds || [])[0] || {};
    const ml = (side) => { const m = o.moneyline && o.moneyline[side]; const v = m && ((m.close && m.close.odds) || (m.open && m.open.odds)); return v != null && v !== '' ? Number(String(v).replace('+', '')) : null; };
    const mlH = ml('home'), mlA = ml('away');
    const det = String(o.details || ''); const dm = det.match(/^([A-Z]+)\s+(-?[\d.]+)$/);
    let spread_home = null; if (dm) { const favC = code(dm[1]); const v = Number(dm[2]); spread_home = favC === hc ? v : -v; } else if (/EVEN|PK/i.test(det)) spread_home = 0;
    const total = o.overUnder != null ? Number(o.overUnder) : null;
    const posted_margin = spread_home != null ? -spread_home : model_margin;
    const proj_margin = r1(0.35 * model_margin + 0.65 * posted_margin);
    const proj_total = r1(total != null ? 0.35 * model_total + 0.65 * total : model_total);
    const proj_home = r1((proj_total + proj_margin) / 2), proj_away = r1((proj_total - proj_margin) / 2);
    let pH = implied(mlH), pA = implied(mlA); if (pH != null && pA != null) { const s = pH + pA; pH /= s; pA /= s; }
    const modelHome = phi(model_margin / 13.5);
    const home_pct = Math.round(100 * (pH != null ? 0.4 * modelHome + 0.6 * pH : modelHome)), away_pct = 100 - home_pct;
    const pick = home_pct >= away_pct ? hc : ac, pick_pct = Math.max(home_pct, away_pct);
    const agree = (model_margin >= 0 ? hc : ac) === (pH != null ? (pH >= 0.5 ? hc : ac) : pick);
    const conf = pick_pct >= 68 && agree ? 'High' : pick_pct >= 58 ? 'Medium' : 'Low';
    const total_gap = total != null ? r1(model_total - total) : 0;
    const total_lean = total == null ? 'Coin toss' : total_gap >= 3 ? 'Lean over' : total_gap <= -3 ? 'Lean under' : 'Coin toss';
    const cover_pick = spread_home == null ? pick : proj_margin > -spread_home ? hc : ac;
    const over = (t, L) => (games[t] || []).filter((g) => L != null && g.pf + g.pa > L).length;
    const [day, title] = slot(e.date);
    const fav = spread_home == null ? pick : spread_home <= 0 ? hc : ac;
    out.push({ id: `${ac}-${hc}`, away: ac, home: hc, away_name: A.team.displayName, home_name: H.team.displayName, kick: kickText(e.date), day, title,
      spread_home, total, ml_away: mlA, ml_home: mlH, provider_home: pH != null ? Math.round(pH * 100) : null, fav, fav_line: spread_home != null ? Math.abs(spread_home) : null,
      model_home, model_away, model_margin, model_total, proj_home, proj_away, proj_margin, proj_total, pick, pick_pct, home_pct, away_pct, conf, total_lean, total_gap, cover_pick, agree,
      a_over: over(ac, total), h_over: over(hc, total), a_n: (games[ac] || []).length, h_n: (games[hc] || []).length, ats_pick: cover_pick, ats_edge: spread_home != null ? r1(Math.abs(proj_margin + spread_home)) : null, iso: e.date });
  }
  out.sort((a, b) => (a.iso < b.iso ? -1 : 1));
  // Game-page stats (nflinfo) for each game: team style from ESPN team statistics, injuries from ESPN's
  // injury report, over/under history against this week's total, and short matchup notes.
  const lg = { ppg: avg(table.map((t) => t.pf)) || 22, papg: avg(table.map((t) => t.pa)) || 22 };
  const rankBy = (k, asc) => { const l = table.slice().sort((a, b) => (asc ? a[k] - b[k] : b[k] - a[k])); return Object.fromEntries(l.map((t, i) => [t.team, i + 1])); };
  const offRank = rankBy('pf', false), defRank = rankBy('pa', true);
  const idOf = Object.fromEntries(teams.map((t) => [code(t.abbreviation), t.id]));
  const inj = await getJson(`${SITE}injuries`).catch(() => ({ injuries: [] }));
  const injBy = {};
  for (const t of inj.injuries || []) { const tm = teams.find((x) => x.displayName === t.displayName); if (!tm) continue; injBy[code(tm.abbreviation)] = (t.injuries || []).map((x) => ({ player: x.athlete && x.athlete.displayName, pos: x.athlete && x.athlete.position && x.athlete.position.abbreviation, status: /injured reserve/i.test(x.status) ? 'IR' : x.status, reason: (x.details && x.details.type) || '' })).filter((x) => x.player); }
  // Every finished game's box score (once per game): what each team's defence allowed and its pass rush,
  // plus offence efficiency (3rd down, red zone, yards per play).
  const box = {};
  const evIds = [...new Set(Object.values(games).flat().map((g) => g.ev))];
  for (const id of evIds) {
    const sm = await getJson(`${SITE}summary?event=${id}`).catch(() => null); if (!sm || !sm.boxscore) continue;
    const tm = (sm.boxscore.teams || []).map((t) => ({ team: code(t.team.abbreviation), st: Object.fromEntries((t.statistics || []).map((x) => [x.name, x.displayValue])) }));
    const dfn = Object.fromEntries((sm.boxscore.players || []).map((pl) => { const d = (pl.statistics || []).find((x) => x.name === 'defensive'); const k = (d && d.keys) || [], tot = (d && d.totals) || []; return [code(pl.team.abbreviation), Object.fromEntries(k.map((kk, i) => [kk, Number(tot[i]) || 0]))]; }));
    box[id] = { tm, dfn };
  }
  const frac = (v) => { const m = String(v || '').match(/^(\d+)-(\d+)/); return m ? [Number(m[1]), Number(m[2])] : [0, 0]; };
  const num = (v) => { const n = Number(String(v || '').replace(/[^\d.-]/g, '')); return isFinite(n) ? n : 0; };
  const prof = (t) => {
    const acc = { g: 0, oPass: 0, oRush: 0, oTot: 0, oPlays: 0, o3c: 0, o3a: 0, oRzc: 0, oRza: 0, oDrop: 0, sacks: 0, qbh: 0, tfl: 0, pd: 0, own3c: 0, own3a: 0, ownRzc: 0, ownRza: 0, ownYds: 0, ownPlays: 0, pen: 0, top: 0 };
    for (const g of games[t] || []) {
      const bx = box[g.ev]; if (!bx) continue;
      const me = bx.tm.find((x) => x.team === t), op = bx.tm.find((x) => x.team !== t); if (!me || !op) continue;
      acc.g++;
      acc.oPass += num(op.st.netPassingYards); acc.oRush += num(op.st.rushingYards); acc.oTot += num(op.st.totalYards); acc.oPlays += num(op.st.totalOffensivePlays);
      const [c3, a3] = frac(op.st.thirdDownEff), [rzc, rza] = frac(op.st.redZoneAttempts), [sk] = frac(op.st.sacksYardsLost), [, att] = String(op.st.completionAttempts || '0/0').split('/').map(Number);
      acc.o3c += c3; acc.o3a += a3; acc.oRzc += rzc; acc.oRza += rza; acc.oDrop += (att || 0) + sk;
      const d = bx.dfn[t] || {}; acc.sacks += d.sacks || sk; acc.qbh += d.QBHits || 0; acc.tfl += d.tacklesForLoss || 0; acc.pd += d.passesDefended || 0;
      const [m3c, m3a] = frac(me.st.thirdDownEff), [mrc, mra] = frac(me.st.redZoneAttempts);
      acc.own3c += m3c; acc.own3a += m3a; acc.ownRzc += mrc; acc.ownRza += mra; acc.ownYds += num(me.st.totalYards); acc.ownPlays += num(me.st.totalOffensivePlays);
      acc.pen += frac(me.st.totalPenaltiesYards)[1];
      const tp = String(me.st.possessionTime || '0:0').split(':').map(Number); acc.top += (tp[0] || 0) + (tp[1] || 0) / 60;
    }
    const n = acc.g || 1, pc = (a, b) => (b ? Math.round((100 * a) / b) : null);
    return { d_games: acc.g, d_pass: r1(acc.oPass / n), d_rush: r1(acc.oRush / n), d_total: r1(acc.oTot / n), d_ypp: acc.oPlays ? r1(acc.oTot / acc.oPlays) : null,
      d_third: pc(acc.o3c, acc.o3a), d_rz: pc(acc.oRzc, acc.oRza), d_sacks_pg: r1(acc.sacks / n), d_qbhits_pg: r1(acc.qbh / n), d_pressure_pg: r1((acc.sacks + acc.qbh) / n), d_sack_rate: pc(acc.sacks, acc.oDrop), d_tfl_pg: r1(acc.tfl / n), d_pd_pg: r1(acc.pd / n),
      o_third: pc(acc.own3c, acc.own3a), o_rz: pc(acc.ownRzc, acc.ownRza), o_ypp: acc.ownPlays ? r1(acc.ownYds / acc.ownPlays) : null, o_total: r1(acc.ownYds / n), pen_ypg: r1(acc.pen / n), top: acc.g ? (Math.floor(acc.top / n) + ':' + String(Math.round((acc.top / n % 1) * 60)).padStart(2, '0')) : null };
  };
  // League ranks for the defence numbers (1 = best)
  const allProf = Object.fromEntries(table.map((t) => [t.team, prof(t.team)]));
  const rk = (k, lowGood) => { const l = Object.entries(allProf).filter(([, v]) => v[k] != null).sort((a, b) => (lowGood ? a[1][k] - b[1][k] : b[1][k] - a[1][k])); return Object.fromEntries(l.map(([t], i) => [t, i + 1])); };
  const rkPass = rk('d_pass', true), rkRush = rk('d_rush', true), rkPres = rk('d_pressure_pg', false), rkTot = rk('d_total', true);
  const styleCache = {};
  const styleOf = async (t) => {
    if (styleCache[t]) return styleCache[t];
    const s = await getJson(`${SITE}teams/${idOf[t]}/statistics`).catch(() => null);
    const cats = (s && s.results && s.results.stats && s.results.stats.categories) || [];
    const v = (cat, name) => { const c = cats.find((x) => x.name === cat); const st = c && (c.stats || []).find((x) => x.name === name); return st && st.value != null ? Number(st.value) : null; };
    const gp = v('general', 'gamesPlayed') || v('passing', 'teamGamesPlayed') || (games[t] || []).length || 1;
    const pa = v('passing', 'passingAttempts'), ra = v('rushing', 'rushingAttempts');
    const st = { pass_ypg: v('passing', 'passingYardsPerGame') != null ? r1(v('passing', 'passingYardsPerGame')) : null, rush_ypg: v('rushing', 'rushingYardsPerGame') != null ? r1(v('rushing', 'rushingYardsPerGame')) : null,
      pass_att: pa != null ? r1(pa / gp) : null, rush_att: ra != null ? r1(ra / gp) : null, pass_share: pa != null && ra != null ? Math.round((100 * pa) / (pa + ra)) : null,
      sacks_allowed: v('passing', 'sacks'), turnovers: v('miscellaneous', 'totalGiveaways'), d_sacks: v('defensive', 'sacks'), takeaways: v('miscellaneous', 'totalTakeaways'),
      ...allProf[t], d_pass_rank: rkPass[t], d_rush_rank: rkRush[t], d_pressure_rank: rkPres[t], d_total_rank: rkTot[t] };
    const r = T[t];
    const ord = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
    st.summary = `${st.pass_share == null ? 'Offence' : st.pass_share >= 60 ? 'Pass-first offence' : st.pass_share <= 50 ? 'Run-heavy offence' : 'Balanced offence'} (about ${Math.round(st.pass_att || 0)} pass attempts vs ${Math.round(st.rush_att || 0)} rushes) scoring ${r.pf} a game (${ord(offRank[t])} of 32) and allowing ${r.pa} (${ord(defRank[t])}).` + (st.d_pass_rank ? ` Defence ranks ${ord(st.d_pass_rank)} against the pass and ${ord(st.d_rush_rank)} against the run, with ${st.d_pressure_pg} sacks + QB hits a game (${ord(st.d_pressure_rank)}).` : '');
    return (styleCache[t] = st);
  };
  const pct = (arr, q) => { const l = arr.slice().sort((a, b) => a - b); return l.length ? l[Math.min(l.length - 1, Math.max(0, Math.floor(q * (l.length - 1))))] : null; };
  const info = [];
  for (const g of out) {
    const side = async (t) => {
      const r = T[t], l = games[t] || [], hh = l.filter((x) => x.home && !x.neutral), aa = l.filter((x) => !x.home && !x.neutral);
      const injs = injBy[t] || [];
      return { team: t, n: r.played, ppg: r.pf, papg: r.pa, off_rating: r1(r.pf - lg.ppg), def_rating: r1(lg.papg - r.pa), off_rank: offRank[t], def_rank: defRank[t],
        home: { n: hh.length, rec: r.home_rec, pf: r.home_pf, pa: r.home_pa }, away: { n: aa.length, rec: r.away_rec, pf: r.away_pf, pa: r.away_pa }, neutral: l.filter((x) => x.neutral).length,
        style: await styleOf(t), injuries: injs.filter((x) => x.status !== 'IR'), ir: injs.filter((x) => x.status === 'IR').length,
        lineup: { status: 'Projected', offense: null, defense: null, note: 'Starters are added when the depth chart is checked before kick-off.' },
        checked: new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date()) + ', AEDT (time of fetch)',
        sources: [`https://www.espn.com/nfl/team/schedule/_/name/${t.toLowerCase()}`, `https://www.espn.com/nfl/team/stats/_/name/${t.toLowerCase()}`, 'https://www.espn.com/nfl/injuries'],
        ou: { over: l.filter((x) => g.total != null && x.pf + x.pa > g.total).length, under: l.filter((x) => g.total != null && x.pf + x.pa < g.total).length, n: l.length } };
    };
    const A = await side(g.away), H = await side(g.home);
    const tots = [...(games[g.away] || []), ...(games[g.home] || [])].map((x) => x.pf + x.pa);
    const ol = pct(tots, 0.25), ul = pct(tots, 0.75);
    const combined = { n: tots.length, over_line: ol, over_hit: tots.filter((x) => x > ol - 0.5).length + '/' + tots.length, under_line: ul, under_hit: tots.filter((x) => x < ul + 0.5).length + '/' + tots.length, min: Math.min(...tots), max: Math.max(...tots), avg: r1(avg(tots) || 0) };
    const lean = (st) => (st.pass_share == null ? 'balanced' : st.pass_share >= 60 ? 'pass-heavy' : st.pass_share <= 50 ? 'run-heavy' : 'balanced');
    const matchup = [
      `${g.away} offence is ${lean(A.style)}${A.style.pass_share != null ? ' (' + A.style.pass_share + '% pass attempts)' : ''}, scoring ${A.ppg} a game (${A.off_rank} of 32); ${g.home} defence allows ${H.papg} (${H.def_rank} of 32).`,
      `${g.home} offence is ${lean(H.style)}${H.style.pass_share != null ? ' (' + H.style.pass_share + '% pass attempts)' : ''}, scoring ${H.ppg} (${H.off_rank} of 32); ${g.away} defence allows ${A.papg} (${A.def_rank} of 32).`,
      `Scoring-average read: ${g.away} about ${g.model_away}, ${g.home} about ${g.model_home} (total ${g.model_total} vs posted ${g.total}).`];
    const hm = H.home.n ? r1(H.home.pf - H.home.pa) : null, am = A.away.n ? r1(A.away.pf - A.away.pa) : null;
    info.push({ id: g.id, away: A, home: H, combined, matchup, home_edge: { away_road_margin: am, home_margin: hm } });
  }
  write('nflgames.json', out.map(({ iso, ...g }) => g)); write('nfltable.json', table); write('nflinfo.json', info);
  console.log(`NFL week: ${out.length} games (${out[0] ? out[0].kick : '-'} to ${out.length ? out[out.length - 1].kick : '-'}); table ${table.length} teams`);
  out.forEach((g) => console.log(`  ${g.kick}  ${g.id}  pick ${g.pick} ${g.pick_pct}% (${g.conf})  spread ${g.spread_home}  total ${g.total} ${g.total_lean}`));
})().catch((e) => { console.error(e.message || e); process.exit(1); });
