// Value track record (private, Mac only: public/data/valuelog.json). Answers "when we say 75% at $1.40, does it
// really win 75%, and do our 'value' bets (our chance above the bookie's) make money?"
//
//   node scripts/value-log.js snap     save our chance + best AU price for every bet on a game that has not started:
//                                      game markets (odds.json), alternate lines (altlines.json), player props
//                                      (propbook.json, our chance 50%+). Re-running updates them, so the saved price
//                                      is the last one before kick-off; the first price seen is kept too.
//   node scripts/value-log.js grade    settle finished bets from history.json (scores) and the game logs
//                                      (pgl.json NBA, nflp.json NFL). No credits used.
//   node scripts/value-log.js report   hit rate and profit ($1 a bet) by our chance and by edge.
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'public', 'data');
const read = (f, d = []) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch (e) { return d; } };
const FILE = path.join(DATA, 'valuelog.json');
const sydDay = (iso) => new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso)).replace(',', '');
const usDate = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso)); // YYYY-MM-DD
const r1 = (x) => Math.round(x * 10) / 10;

function snap() {
  const log = read('valuelog.json'), by = new Map(log.map((x) => [x.key, x])), now = Date.now(), at = new Date().toISOString();
  let added = 0, updated = 0;
  const put = (row) => {
    if (!row.price || !(row.price > 1) || !Number.isFinite(row.our) || new Date(row.kick).getTime() <= now) return;
    const key = [row.src, row.sp, row.game, row.day, row.market, row.pick].join('|');
    const old = by.get(key);
    if (old) { Object.assign(old, { our: row.our, price: row.price, book: row.book, implied: r1(100 / row.price), edge: r1(row.our - 100 / row.price), last: at }); updated++; }
    else { const x = { key, ...row, implied: r1(100 / row.price), edge: r1(row.our - 100 / row.price), our0: row.our, price0: row.price, first: at, last: at, status: 'open' }; by.set(key, x); log.push(x); added++; }
  };
  for (const o of read('odds.json').filter((x) => x.sp !== 'ufc')) put({ src: 'game', sp: o.sp, game: o.game, day: sydDay(o.kick), kick: o.kick, match: o.match, market: o.market, pick: o.pick, point: o.point, our: Number(o.our), price: Number(o.price), book: o.book });
  for (const a of read('altlines.json')) if (a.our >= 50 && a.price >= 1.2) put({ src: 'alt', sp: a.sp, game: a.game, day: a.day, kick: a.kick, match: a.match, market: a.market, pick: a.pick, point: a.point, our: a.our, price: a.price, book: a.book });
  for (const p of read('propbook.json')) if (p.chance >= 50 && p.price >= 1.2 && p.kick) put({ src: 'prop', sp: p.sp || 'nba', game: p.game, day: p.day, kick: p.kick, market: p.stat, pick: p.pick, stat: p.stat, line: p.line, side: p.side, pid: p.pid, player: p.player, team: p.team, our: p.chance, price: p.price, book: p.book });
  fs.writeFileSync(FILE, JSON.stringify(log));
  console.log(`valuelog: ${added} new, ${updated} updated, ${log.length} saved (${log.filter((x) => x.status === 'open').length} open).`);
}

function grade() {
  const log = read('valuelog.json'); if (!log.length) { console.log('valuelog: nothing saved yet'); return; }
  const hist = read('history.json').filter((h) => h.status === 'Final' && h.away_pts != null);
  let nba = null, nfl = null; // game logs, loaded only if a prop needs them
  const logs = (sp) => {
    if (sp === 'nba') { if (!nba) { const pf = require('./prop-finder.js'); const P = pf.loadPlayers(); nba = { P, val: (g, st) => g.v[st], teams: new Set(P.flatMap((p) => p.games.map((g) => g.team + '|' + g.date))) }; } return nba; }
    if (!nfl) { const nf = require('./nfl-prop-finder.js'); const P = nf.loadPlayers(); nfl = { P, val: (g, st) => nf.valOf(g, st), teams: new Set(P.flatMap((p) => p.games.map((g) => g.team + '|' + g.date))) }; } return nfl;
  };
  let n = 0;
  for (const x of log) {
    if (x.status !== 'open' || new Date(x.kick).getTime() > Date.now() - 3 * 3600000) continue;
    let res = null;
    if (x.src === 'prop') {
      if (['FB', 'FTD', 'LTD'].includes(x.stat)) { res = 'void'; }
      else {
        const L = logs(x.sp), d = usDate(x.kick), p = L.P.find((q) => String(q.pid) === String(x.pid));
        const g = p && p.games.find((q) => q.date === d);
        if (g) { const v = L.val(g, x.stat); if (v === undefined) continue; const over = v > x.line; res = v === x.line ? 'void' : (x.side === 'over') === over ? 'won' : 'lost'; x.result = v; }
        else if (L.teams.has(x.team + '|' + d)) res = 'void'; // his team played, he didn't: bookies void it
      }
    } else {
      const h = hist.find((q) => (q.sport || 'nba') === x.sp && q.id === x.game && q.date === x.day); if (!h) continue;
      const [A, H] = x.sp === 'fb' ? String(x.match).split(' v ').reverse() : String(x.match).split(' @ ');
      const hp = Number(h.home_pts), ap = Number(h.away_pts), tot = hp + ap;
      const home = x.pick.startsWith(H + ' '), away = x.pick.startsWith(A + ' ');
      if (x.market === 'Winner') res = x.pick === 'Draw' ? (hp === ap ? 'won' : 'lost') : home ? (hp > ap ? 'won' : 'lost') : away ? (ap > hp ? 'won' : 'lost') : null;
      else if (x.market === 'Spread') { const m = (home ? hp - ap : ap - hp) + Number(x.point); res = !home && !away ? null : m === 0 ? 'void' : m > 0 ? 'won' : 'lost'; }
      else if (/^Total/.test(x.market)) { const pt = Number(x.point ?? x.pick.split(' ').pop()); res = tot === pt ? 'void' : (/^Over/.test(x.pick) ? tot > pt : tot < pt) ? 'won' : 'lost'; }
      else if (x.market === 'Both teams to score') res = (hp > 0 && ap > 0) === /Both score/.test(x.pick) ? 'won' : 'lost';
      x.result = ap + '-' + hp;
    }
    if (res) { x.status = res; x.graded = new Date().toISOString(); n++; }
  }
  fs.writeFileSync(FILE, JSON.stringify(log));
  console.log(`valuelog: ${n} settled now; ${log.filter((x) => x.status === 'open').length} still open.`);
}

function report() {
  const done = read('valuelog.json').filter((x) => x.status === 'won' || x.status === 'lost');
  if (!done.length) { console.log('No settled bets in the track record yet.'); return; }
  const line = (lab, a) => { if (!a.length) return; const w = a.filter((x) => x.status === 'won').length, pnl = a.reduce((t, x) => t + (x.status === 'won' ? x.price - 1 : -1), 0), said = a.reduce((t, x) => t + x.our, 0) / a.length, imp = a.reduce((t, x) => t + 100 / x.price, 0) / a.length;
    console.log(`  ${lab.padEnd(26)} ${String(a.length).padStart(5)}  won ${String(Math.round((100 * w) / a.length)).padStart(3)}%  we said ${Math.round(said)}%  bookie said ${Math.round(imp)}%  profit $${pnl.toFixed(2)} (${((100 * pnl) / a.length).toFixed(1)}%)`); };
  const days = [...new Set(done.map((x) => x.day))];
  console.log(`Track record: ${done.length} settled bets over ${days.length} days ($1 a bet, last price before kick-off)`);
  for (const src of ['game', 'alt', 'prop']) {
    const a = done.filter((x) => x.src === src); if (!a.length) continue;
    console.log({ game: 'Game markets (main lines)', alt: 'Alternate lines', prop: 'Player props' }[src] + ':');
    [[50, 60], [60, 70], [70, 80], [80, 90], [90, 101]].forEach(([lo, hi]) => line(`our chance ${lo}-${hi === 101 ? 100 : hi}%`, a.filter((x) => x.our >= lo && x.our < hi)));
    [[-99, 0], [0, 5], [5, 10], [10, 99]].forEach(([lo, hi]) => line(`edge ${lo === -99 ? 'below 0' : lo + ' to ' + hi}`, a.filter((x) => x.edge >= lo && x.edge < hi)));
    line('Best bets rule (75%+, $1.30+)', a.filter((x) => x.our >= 75 && x.price >= 1.3));
  }
}

const cmd = process.argv[2];
if (cmd === 'snap') snap(); else if (cmd === 'grade') grade(); else if (cmd === 'report') report();
else { console.error('Usage: node scripts/value-log.js snap | grade | report'); process.exit(1); }
