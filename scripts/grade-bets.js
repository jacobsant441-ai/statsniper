// Settles the owner's logged bets (public/data/bets.json) from final results (history.json) and NBA
// player box scores (pact.json). Run after grade.js. Open bets whose game isn't final stay open.
//
// bets.json rows: {id, placed, sp, game, date, match, pick, market, line, price, stake, book, status}
//   market: 'Winner' (pick 'Celtics win' / 'Draw'), 'Total' or 'Goals' (pick 'Over 2.5' / 'Under 223.5'),
//   'BTTS' ('Both score' / 'Not both'), 'Spread' ('Celtics -11.5'), 'Prop' ('Jayson Tatum Over 27.5 PTS').
//   date is the Sydney day key of the game ('Thu 5 Nov'), so a repeat fixture is not mixed up.
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'public', 'data');
const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f + '.json'), 'utf8')); } catch (e) { return []; } };
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const same = (a, b) => { a = norm(a); b = norm(b); return a && b && (a === b || a.includes(b) || b.includes(a)); };

// Multis: {type: 'multi', price, stake, bonus, legs: [{sp, game, date, match, market, pick, price, status}]}.
//   Each leg is settled like a single; a multi is lost when any leg loses and won when every leg has won
//   (a void leg drops out). Legs the scripts can't grade (market 'Player', 'Unknown') are set by hand in chat.
// Bonus bets (bonus: true): a win pays stake × (price − 1), a loss costs nothing.
const bets = read('bets'), hist = read('history'), pact = read('pact');
let settled = 0;
const singles = [];
for (const b of bets) {
  if (b.status === 'placeholder') continue;
  if (b.legs) singles.push(...b.legs); else singles.push(b);
}
for (const b of singles) {
  if (b.status && b.status !== 'open') continue;
  const h = hist.find((x) => (x.sport || 'nba') === b.sp && x.id === b.game && (!b.date || x.date === b.date) && x.status === 'Final');
  if (!h) continue;
  const hp = Number(h.home_pts), ap = Number(h.away_pts), tot = hp + ap;
  let won = null;
  const ou = String(b.pick).match(/^(Over|Under) ([\d.]+)/i);
  if (b.market === 'Winner') {
    if (/^draw$/i.test(b.pick)) won = hp === ap;
    else { const team = String(b.pick).replace(/ win$/i, ''); const home = same(team, h.home_name) || team === h.home; won = hp === ap ? false : home ? hp > ap : ap > hp; }
  } else if ((b.market === 'Total' || b.market === 'Goals') && ou) {
    const L = Number(ou[2]); won = tot === L ? null : /over/i.test(ou[1]) ? tot > L : tot < L; if (tot === L) b.status = 'void';
  } else if (b.market === 'BTTS' || /^(both score|not both)$/i.test(b.pick)) {
    const both = hp > 0 && ap > 0; won = /^both/i.test(b.pick) ? both : !both;
  } else if (b.market === 'Spread') {
    const m = String(b.pick).match(/^(.*) ([+-][\d.]+)$/); if (m) { const home = same(m[1], h.home_name); const mg = (home ? hp - ap : ap - hp) + Number(m[2]); if (mg === 0) b.status = 'void'; else won = mg > 0; }
  } else if (b.market === 'Prop') {
    const m = String(b.grade || b.pick).match(/^(.*) (Over|Under) ([\d.]+) (PTS|REB|AST|3PM)$/i); // grade: 'Name Over 19.5 PTS' when pick is display text ('20+ points')
    const r = m && pact.find((x) => x.game === b.game && same(x.player, m[1]));
    if (r) { const v = { PTS: r.pts, REB: r.reb, AST: r.ast, '3PM': r.tpm }[m[4].toUpperCase()]; if (v != null) won = /over/i.test(m[2]) ? v > Number(m[3]) : v < Number(m[3]); }
  }
  if (b.status === 'void') { settled++; continue; }
  if (won == null) continue;
  b.status = won ? 'won' : 'lost'; b.final = `${h.away_name} ${ap} - ${hp} ${h.home_name}`; settled++;
}
const today = new Date().toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney', weekday: 'short', day: 'numeric', month: 'short' }).replace(/,/g, '');
for (const b of bets) {
  if (!b.legs || (b.status && b.status !== 'open')) continue;
  if (b.legs.some((x) => x.status === 'lost')) { b.status = 'lost'; b.settled = today; settled++; }
  else if (b.legs.every((x) => x.status === 'won' || x.status === 'void')) { b.status = b.legs.every((x) => x.status === 'void') ? 'void' : 'won'; b.settled = today; settled++; }
}
// singles: date settled for the Review list
for (const b of bets) if (!b.legs && b.status && b.status !== 'open' && b.status !== 'placeholder' && !b.settled) b.settled = b.date || today;
fs.writeFileSync(path.join(DATA, 'bets.json'), JSON.stringify(bets));
const s = bets.filter((b) => b.status === 'won' || b.status === 'lost');
const profit = s.reduce((t, b) => t + (b.status === 'won' ? Number(b.stake) * (Number(b.price) - 1) : b.bonus ? 0 : -Number(b.stake || 0)), 0);
console.log(`bets: ${settled} settled now; ${bets.filter((b) => !b.status || b.status === 'open').length} open; record ${s.filter((b) => b.status === 'won').length}-${s.filter((b) => b.status === 'lost').length}, profit ${profit.toFixed(2)}`);
