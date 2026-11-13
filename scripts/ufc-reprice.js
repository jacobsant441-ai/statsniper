// UFC: writes the live Australian prices from odds.json (fetch-odds.js, The Odds API) into the fight cards in
// ufcfights.json and redoes each pick with the UFC method on those prices:
//   win chance = 70% market (live prices, margin removed) + 30% record model; confidence High 68%+, Medium 58%+.
// Also stores the best price and book for each fighter and the total-rounds lines (Over / Under), shown on the cards.
// Fights without a live price keep what they had. No credits (reads the saved odds only).
// Usage: node scripts/ufc-reprice.js
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'public', 'data');
const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch (e) { return []; } };
const strip = (s) => String(s || '').replace(/\s*\(c\)/, '');
const toAm = (d) => (d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1)));
const r1 = (x) => Math.round(x * 10) / 10;

const fights = read('ufcfights.json'), odds = read('odds.json').filter((o) => o.sp === 'ufc');
if (!fights.length) { console.log('ufc-reprice: no fights on file'); process.exit(0); }
let n = 0;
for (const f of fights) {
  const rs = odds.filter((o) => o.game === f.id); if (!rs.length) continue;
  const wa = rs.find((o) => o.market === 'Winner' && o.pick === strip(f.a) + ' win'), wb = rs.find((o) => o.market === 'Winner' && o.pick === strip(f.b) + ' win');
  if (!wa || !wb) continue;
  f.a_price = wa.price; f.a_book = wa.book; f.b_price = wb.price; f.b_book = wb.book;
  f.a_odds = toAm(wa.price); f.b_odds = toAm(wb.price);
  if (wa.mkt_a != null) { f.a_mkt = r1(wa.mkt_a); f.b_mkt = r1(100 - wa.mkt_a); }
  const aFin = wa.our;
  f.pick = aFin >= 50 ? f.a : f.b; f.pick_pct = Math.round(Math.max(aFin, 100 - aFin));
  f.conf = f.pick_pct >= 68 ? 'High' : f.pick_pct >= 58 ? 'Medium' : 'Low';
  f.pick_basis = '70% market (live AU prices), 30% record model';
  f.odds_at = wa.fetched || new Date().toISOString();
  const pts = [...new Set(rs.filter((o) => o.market === 'Total rounds').map((o) => o.point))].sort((a, b) => a - b);
  f.rounds_lines = pts.map((pt) => {
    const ov = rs.find((o) => o.market === 'Total rounds' && o.point === pt && /^Over/.test(o.pick)), un = rs.find((o) => o.market === 'Total rounds' && o.point === pt && /^Under/.test(o.pick));
    return { pt, over: ov ? ov.price : null, over_book: ov ? ov.book : '', under: un ? un.price : null, under_book: un ? un.book : '', over_pct: ov ? Math.round(ov.our) : null };
  }).filter((x) => x.over || x.under);
  n++;
}
fs.writeFileSync(path.join(DATA, 'ufcfights.json'), JSON.stringify(fights));
console.log(`ufc-reprice: ${n} fights repriced from live odds`);
