// Keeps a copy of every graded game's pre-game data so Review can open the full game page
// (the same sections as Picks) after the slate has moved on.
// Usage: node scripts/archive.js   (run straight after grade.js, before new slates replace the data)
//
// Reads history plus the pick datasets below; writes public/data/archive.json:
//   [{k: 'sport|id|date', sp, id, date, at, data: {<dataset>: [rows for this game]}}]
// Only games whose pre-game rows are still on file are archived; existing entries are kept as
// they are. The newest KEEP entries are kept so the file stays small.
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'public', 'data');
const KEEP = 160; // about ten days of games across all sports
const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f + '.json'), 'utf8')); } catch (e) { return []; } };
const normDay = (s) => String(s || '').replace(/^(\w+) 0(\d) /, '$1 $2 ');

// NBA datasets with one or more rows per game (field `game` = game id).
const NBA_PER_GAME = ['teams', 'notes', 'lineups', 'slips', 'top', 'plog', 'players', 'pstats', 'ladder', 'log'];

const history = read('history');
const archive = read('archive');
const have = new Set(archive.map((a) => a.k));
const cache = {};
const ds = (n) => (cache[n] = cache[n] || read(n));
const byId = (n, id, day) => { const r = ds(n).filter((x) => x.id === id); return r.length > 1 && day ? r.filter((x) => !x.date || normDay(x.date) === day) : r; };

let added = 0, missing = 0;
for (const h of history) {
  if (h.status !== 'Final') continue;
  const sp = h.sport || 'nba', day = normDay(h.date), k = `${sp}|${h.id}|${day}`;
  if (have.has(k)) continue;
  const data = {};
  if (sp === 'nba') {
    data.games = byId('games', h.id, day);
    if (data.games.length) {
      data.pred = byId('pred', h.id);
      NBA_PER_GAME.forEach((n) => { data[n] = ds(n).filter((x) => x.game === h.id); });
      data.props75 = ds('props75').filter((x) => x.game === h.id && (!x.sport || x.sport === 'nba'));
    }
  } else if (sp === 'fb') { data.fixtures = byId('fixtures', h.id); if (data.fixtures.length) data.uclx = byId('uclx', h.id); }
  else if (sp === 'nfl') {
    data.nflgames = byId('nflgames', h.id);
    if (data.nflgames.length) { data.nflinfo = byId('nflinfo', h.id); data.props75 = ds('props75').filter((x) => x.game === h.id && x.sport === 'nfl'); }
  } else if (sp === 'ufc') data.ufcfights = byId('ufcfights', h.id);
  const main = data.games || data.fixtures || data.nflgames || data.ufcfights || [];
  if (!main.length) { missing++; continue; }
  archive.push({ k, sp, id: h.id, date: day, at: new Date().toISOString(), data });
  have.add(k); added++;
}
const out = archive.slice(-KEEP);
fs.writeFileSync(path.join(DATA, 'archive.json'), JSON.stringify(out));
console.log(`archive: ${added} games added, ${out.length} kept (${(fs.statSync(path.join(DATA, 'archive.json')).size / 1024).toFixed(0)} KB); ${missing} graded games had no pre-game data left to copy`);
