// UFC: fills one card's bouts in public/data/ufcfights.json from the fighter profiles (ufcp.json) and
// Australian bookmaker odds (The Odds API, 1 credit), then makes the picks with the UFC method:
// win chance = 70% market (odds, margin removed) + 30% record model; pick the fighter above 50%;
// confidence High 68%+, Medium 58%+, else Low.
// Record model: smoothed win rate (wins+1)/(fights+2), plus half a point per inch of reach advantage and
// minus a point per year over 35, turned into a chance around 50%.
// Career UFC rates (strikes, takedowns, submissions) come from ESPN's per-fight stats in ufcp.
// Usage: ODDS_API_KEY=… node scripts/ufc-card.js <event_id>     (e.g. ufc-2026-11-07; key optional)
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'public', 'data');
const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const EV = process.argv[2];
if (!EV) { console.error('Usage: node scripts/ufc-card.js <event_id>'); process.exit(1); }
const cut = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\(c\)/g, '').replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
const r1 = (x) => Math.round(x * 10) / 10;
const implied = (o) => (o == null ? null : o > 0 ? 100 / (o + 100) : -o / (-o + 100));
const toAm = (d) => (d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1)));
const FK = { date: 0, event: 1, ufc: 2, opp: 3, oppId: 4, res: 5, method: 6, detail: 7, round: 8, clock: 9, secs: 10, title: 11, sigL: 12, sigA: 13, totL: 14, totA: 15, kd: 16, tdL: 17, tdA: 18, sub: 19, oSigL: 20, oSigA: 21, oTdL: 22, oTdA: 23, oKd: 24 };

(async () => {
  const fights = read('ufcfights.json'), ufcp = read('ufcp.json');
  const by = new Map(ufcp.map((r) => [cut(r.name), r]));
  const card = fights.filter((f) => f.event_id === EV);
  if (!card.length) { console.error('No bouts for ' + EV); process.exit(1); }
  // Odds (optional)
  let odds = [];
  if (process.env.ODDS_API_KEY) {
    try {
      const res = await fetch(`https://api.the-odds-api.com/v4/sports/mma_mixed_martial_arts/odds?apiKey=${process.env.ODDS_API_KEY}&regions=au&markets=h2h&oddsFormat=decimal`);
      odds = res.ok ? await res.json() : []; console.log('odds: ' + odds.length + ' MMA events, credits left ' + res.headers.get('x-requests-remaining'));
    } catch (e) { console.log('odds: unavailable (' + e.message + ')'); }
  }
  const sur = (n) => cut(n).split(' ').slice(-1)[0];
  const priceOf = (a, b) => {
    const ev = odds.find((e) => { const h = cut(e.home_team), w = cut(e.away_team); return (h.includes(sur(a)) && w.includes(sur(b))) || (h.includes(sur(b)) && w.includes(sur(a))); });
    if (!ev) return null;
    const best = (n) => { let p = null; for (const bk of ev.bookmakers || []) for (const m of bk.markets || []) for (const o of m.outcomes || []) if (cut(o.name).includes(sur(n)) && (!p || o.price > p)) p = o.price; return p; };
    const pa = best(a), pb = best(b); return pa && pb ? { a: pa, b: pb } : null;
  };
  const prof = (name) => {
    const r = by.get(cut(name)); if (!r) return null;
    const raw = Array.isArray(r.f) ? r.f : (() => { try { return JSON.parse(r.f || '[]'); } catch (e) { return []; } })();
    const fs2 = raw.map((a) => { const o = {}; for (const k in FK) o[k] = a[FK[k]]; return o; });
    const own = fs2.filter((f) => f.ufc && f.secs && ((f.sigA || 0) > 0 || (f.tdA || 0) > 0)), opp = own.filter((f) => f.oSigA != null);
    const sum = (l, k) => l.reduce((s, f) => s + (Number(f[k]) || 0), 0), min = (l) => sum(l, 'secs') / 60;
    const pct = (a, b) => (b ? Math.round((100 * a) / b) : null);
    const m = min(own), mo = min(opp);
    const st = { slpm: m ? r1(sum(own, 'sigL') / m) : null, sapm: mo ? r1(sum(opp, 'oSigL') / mo) : null, stracc: pct(sum(own, 'sigL'), sum(own, 'sigA')), strdef: sum(opp, 'oSigA') ? 100 - pct(sum(opp, 'oSigL'), sum(opp, 'oSigA')) : null,
      tdavg: m ? r1((sum(own, 'tdL') / m) * 15) : null, tdacc: pct(sum(own, 'tdL'), sum(own, 'tdA')), tddef: sum(opp, 'oTdA') ? 100 - pct(sum(opp, 'oTdL'), sum(opp, 'oTdA')) : null, subavg: m ? r1((sum(own, 'sub') / m) * 15) : null };
    const style = st.tdavg == null ? 'Unclear (no UFC stats)' : st.tdavg >= 2.5 || st.subavg >= 1 ? 'Wrestler/Grappler' : st.tdavg < 1 && st.slpm >= 3.5 ? 'Striker' : 'Balanced';
    const last = fs2.slice(0, 3).map((f) => `${f.res} ${f.opp} (${f.method || ''}${f.round ? ' R' + f.round : ''}, ${String(f.date).slice(0, 7)})`).join('; ');
    const reach = parseFloat(String(r.reach || '').replace(/[^\d.]/g, '')) || null;
    const [w, l] = String(r.rec || '0-0').split('-').map(Number);
    return { r, st, style, last, reach, w: w || 0, l: l || 0, nUfc: own.length };
  };
  let made = 0;
  for (const f of card) {
    const A = prof(f.a), B = prof(f.b);
    if (A) { f.a_rec = f.a_rec || A.r.rec; f.a_age = f.a_age ?? A.r.age; f.a_reach = f.a_reach ?? A.reach; f.a_height = f.a_height || A.r.height; f.a_stance = f.a_stance || A.r.stance; f.a_style = A.style; f.a_last = A.last; f.a_small = A.nUfc < 3; Object.entries(A.st).forEach(([k, v]) => { f['a_' + k] = v; }); }
    if (B) { f.b_rec = f.b_rec || B.r.rec; f.b_age = f.b_age ?? B.r.age; f.b_reach = f.b_reach ?? B.reach; f.b_height = f.b_height || B.r.height; f.b_stance = f.b_stance || B.r.stance; f.b_style = B.style; f.b_last = B.last; f.b_small = B.nUfc < 3; Object.entries(B.st).forEach(([k, v]) => { f['b_' + k] = v; }); }
    f.rec_basis = 'pro';
    // record model
    const score = (P, age, reach, oReach) => (P ? (100 * (P.w + 1)) / (P.w + P.l + 2) : 50) + (reach && oReach ? 0.5 * (reach - oReach) : 0) - Math.max(0, (age || 0) - 35);
    const sa = score(A, f.a_age, f.a_reach, f.b_reach), sb = score(B, f.b_age, f.b_reach, f.a_reach);
    const aModel = Math.max(10, Math.min(90, 50 + (sa - sb) / 2));
    f.a_model = r1(aModel);
    const pr = priceOf(f.a, f.b);
    if (pr) {
      f.a_odds = toAm(pr.a); f.b_odds = toAm(pr.b);
      let pa = 1 / pr.a, pb = 1 / pr.b; const s = pa + pb; pa /= s; pb /= s;
      f.a_mkt = r1(pa * 100); f.b_mkt = r1(pb * 100);
      const aFin = 0.7 * f.a_mkt + 0.3 * aModel;
      f.pick = aFin >= 50 ? f.a : f.b; f.pick_pct = Math.round(Math.max(aFin, 100 - aFin));
      f.conf = f.pick_pct >= 68 ? 'High' : f.pick_pct >= 58 ? 'Medium' : 'Low';
      f.pick_basis = '70% market, 30% record model'; made++;
    } else if (A && B) {
      f.pick = aModel >= 50 ? f.a : f.b; f.pick_pct = Math.round(Math.max(aModel, 100 - aModel)); f.conf = 'Low';
      f.pick_basis = 'record model only (no odds posted)'; made++;
    }
  }
  fs.writeFileSync(path.join(DATA, 'ufcfights.json'), JSON.stringify(fights));
  console.log(`${EV}: ${card.length} bouts, ${made} picks (${card.filter((f) => f.a_odds != null).length} with odds)`);
  card.forEach((f) => console.log(`  ${f.card.padEnd(10)} ${f.a} ${f.a_rec || '?'} v ${f.b} ${f.b_rec || '?'} | ${f.a_odds ?? '-'} / ${f.b_odds ?? '-'} | pick ${f.pick || '-'} ${f.pick_pct || ''}% ${f.conf || ''}`));
})();
