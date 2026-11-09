// Builds public/data/pidx.json: a small name index for search across every sport, so
// typing in the search box doesn't load the full player and fighter files.
// Usage: npm run build:index (run after any fetch script)
const fs = require('fs');
const path = require('path');
const DATA = path.join(__dirname, '..', 'public', 'data');
const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch (e) { return []; } };
const out = [];
read('pgl.json').forEach((r) => out.push({ sp: 'nba', id: String(r.pid), name: r.player, team: r.team, pos: r.pos, n: r.n }));
read('nflp.json').forEach((r) => out.push({ sp: 'nfl', id: String(r.pid), name: r.player, team: r.team, pos: r.pos, n: r.n }));
read('socp.json').forEach((r) => out.push({ sp: 'fb', id: String(r.pid), name: r.player, team: r.team, pos: r.pos, n: r.n }));
read('ufcp.json').forEach((r) => out.push({ sp: 'ufc', id: String(r.id), name: r.name, team: '', pos: r.wc, rec: r.rec, next: r.next ? r.next.opp : '', n: (JSON.parse(r.f || '[]')).length }));
read('tprof.json').forEach((r) => out.push({ sp: 'team', tsp: r.sp, id: r.sp + ':' + r.code, name: r.name, short: r.short, team: r.code, pos: r.league, rec: r.record }));
fs.writeFileSync(path.join(DATA, 'pidx.json'), JSON.stringify(out));
console.log(`Wrote ${out.length} names to data/pidx.json (${(fs.statSync(path.join(DATA, 'pidx.json')).size / 1024).toFixed(0)} KB)`);
