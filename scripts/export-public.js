// Cleaned-up public copies of the owner's private data, for the public site (runs on the Mac only):
//   pubbets.json  Jacob's picks: the open bets (picks and legs, with their status) and the win-loss record.
//                 No stakes, payouts, profit or past bets.
//   pubprops.json the player props we picked (our chance 75%+ at a $1.30+ AU price, one per player and stat),
//                 with our chance and hit rates but no bookmaker price, book or edge (The Odds API data stays private).
//   pubalts.json  the alternate lines we picked (same rule), without prices.
// Usage: node scripts/export-public.js [outDir]   (default: public/data)
//   --upload  also publish the files that changed to GitHub (one commit each, via the GitHub API with the gh
//             tool's login), without touching this Mac's working copy; the cloud job then rebuilds the site.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DATA = path.join(__dirname, '..', 'public', 'data');
const OUT = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : DATA;
const UPLOAD = process.argv.includes('--upload');
const REPO = 'jacobsant441-ai/statsniper';
const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch (e) { return []; } };
const MIN = 75, PRICE = 1.3, now = Date.now();

// Jacob's picks: open bets only, no money
const bets = read('bets.json').filter((b) => b.status && b.status !== 'placeholder');
const settled = bets.filter((b) => b.status === 'won' || b.status === 'lost');
const legsOf = (b) => (Array.isArray(b.legs) ? b.legs : null);
const legOut = (l) => ({ sp: l.sp, game: l.game, date: l.date, match: l.match, market: l.market, pick: l.pick, status: l.status || 'open', final: l.final || '' });
// a plain list (what the page's data loader expects): the record first, then one row per open bet
const pubbets = [
  { kind: 'record', won: settled.filter((b) => b.status === 'won').length, lost: settled.filter((b) => b.status === 'lost').length },
  ...bets.filter((b) => !b.status || b.status === 'open').map((b) => (legsOf(b)
    ? { kind: 'bet', id: b.id, placed: String(b.placed || '').split(',')[0], sgm: b.sgm === true || b.sgm === 'true', legs: legsOf(b).map(legOut) }
    : { kind: 'bet', id: b.id, placed: String(b.placed || '').split(',')[0], ...legOut(b) })),
];

// Player props we picked: best line per player and stat, no prices
const seen = new Set();
const pubprops = read('propbook.json').filter((r) => r.chance >= MIN && r.price >= PRICE && (!r.kick || new Date(r.kick).getTime() > now - 6 * 3600000))
  .sort((a, b) => b.chance - a.chance)
  .filter((r) => { const k = (r.sp || 'nba') + '|' + r.day + '|' + r.player + '|' + r.stat; if (seen.has(k)) return false; seen.add(k); return true; })
  .map((r) => ({ sp: r.sp || 'nba', game: r.game, day: r.day, kick: r.kick, pid: r.pid, player: r.player, team: r.team, opp: r.opp, stat: r.stat, line: r.line, side: r.side, pick: r.pick, chance: r.chance, hit: r.hit, avg: r.avg, l5: r.l5, proj: r.proj, why: r.why || [] }));

// Alternate lines we picked, no prices
const seenA = new Set();
const pubalts = read('altlines.json').filter((r) => r.our >= MIN && r.price >= PRICE && new Date(r.kick).getTime() > now - 6 * 3600000)
  .sort((a, b) => b.our - a.our)
  .filter((r) => { const k = r.sp + '|' + r.game + '|' + r.day + '|' + r.market + '|' + r.pick.replace(/ [-+]?[\d.]+$/, ''); if (seenA.has(k)) return false; seenA.add(k); return true; })
  .map((r) => ({ sp: r.sp, game: r.game, day: r.day, match: r.match, kick: r.kick, market: r.market, pick: r.pick, point: r.point, our: r.our }));

const files = { 'pubbets.json': pubbets, 'pubprops.json': pubprops, 'pubalts.json': pubalts };
// Guard: nothing money-related may leave this Mac.
const BANNED = /"(stake|price|book|implied|edge|over_book|under_book|bonus|profit|pays)"\s*:/;
for (const [f, v] of Object.entries(files)) if (BANNED.test(JSON.stringify(v))) { console.error('Refusing: ' + f + ' would contain a private number.'); process.exit(1); }

const changed = [];
for (const [f, v] of Object.entries(files)) {
  const txt = JSON.stringify(v);
  if (!UPLOAD) { fs.writeFileSync(path.join(OUT, f), txt); continue; }
  // compare with what GitHub has; upload only what changed
  let sha = null, cur = null;
  try { const j = JSON.parse(execFileSync('gh', ['api', `repos/${REPO}/contents/public/data/${f}?ref=main`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); sha = j.sha; cur = Buffer.from(j.content, 'base64').toString('utf8'); } catch (e) { /* not there yet */ }
  if (cur === txt) continue;
  const args = ['api', '-X', 'PUT', `repos/${REPO}/contents/public/data/${f}`, '-f', `message=Public picks update (${f})`, '-f', `content=${Buffer.from(txt).toString('base64')}`, '-f', 'branch=main'];
  if (sha) args.push('-f', `sha=${sha}`);
  execFileSync('gh', args, { stdio: ['ignore', 'ignore', 'pipe'] }); changed.push(f);
}
console.log(`public copies: ${pubbets.length - 1} open bets (record ${pubbets[0].won}-${pubbets[0].lost}), ${pubprops.length} player props, ${pubalts.length} alt lines` + (UPLOAD ? `; uploaded: ${changed.join(', ') || 'nothing changed'}` : ' (written locally)'));
