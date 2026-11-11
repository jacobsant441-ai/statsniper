// NBA starting lineups for today's and tomorrow's games (Sydney), from ESPN's free feeds:
//   - before tip: each team's ESPN depth chart (kept current as players return or get hurt): the first player at
//     PG, SG, SF, PF and C; if he is out, the next healthy player at that spot (noted). Questionable / day-to-day
//     players are tagged. Status "Projected".
//   - once the game has started: the actual starters from the ESPN box score. Status "Confirmed".
// Replaces the lineups.json rows for those games (other games' rows are kept).
// Runs in the cloud results job (every 30 minutes) and the picks job. Usage: node scripts/fetch-lineups.js
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'public', 'data');
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/';
const CODE = { GS: 'GSW', NO: 'NOP', NY: 'NYK', SA: 'SAS', UTAH: 'UTA', WSH: 'WAS' };
const code = (a) => CODE[a] || a;
const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch (e) { return []; } };
const sydKey = (iso) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', weekday: 'short', day: 'numeric', month: 'short' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value])); return `${p.weekday} ${p.day} ${p.month}`; };
const checkedAt = () => new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) + ' AEDT';
const ymd = (t) => new Date(t).toISOString().slice(0, 10).replace(/-/g, '');
async function getJson(url) {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(url, { headers: { 'User-Agent': 'StatSniper/1.0' } }); if (r.ok) return await r.json(); } catch (e) { /* retry */ }
    await new Promise((res) => setTimeout(res, 1500));
  }
  return null;
}
const OUT = /out|injured reserve|suspend/i, Q = /day-to-day|questionable|doubtful|probable|game-time/i;

async function projected(teamId) {
  const j = await getJson(`${SITE}teams/${teamId}/depthcharts`);
  const pos = j && j.depthchart && j.depthchart[0] && j.depthchart[0].positions; if (!pos) return null;
  const used = new Set(), five = [], notes = [];
  for (const k of ['pg', 'sg', 'sf', 'pf', 'c']) {
    const list = ((pos[k] && pos[k].athletes) || []).map((a) => ({ name: a.displayName, st: (a.injuries && a.injuries[0] && a.injuries[0].status) || '' }));
    const first = list[0]; let pick = list.find((a) => !used.has(a.name) && !OUT.test(a.st));
    if (!pick) continue;
    if (first && first.name !== pick.name && OUT.test(first.st)) notes.push(`${pick.name} in for ${first.name} (out)`);
    used.add(pick.name); five.push(pick.name + (Q.test(pick.st) ? ' (Q)' : ''));
  }
  return five.length ? { five, notes, at: j.timestamp } : null;
}

(async () => {
  const now = Date.now(), days = new Set([sydKey(now), sydKey(now + 86400000)]);
  const games = read('games.json').filter((g) => days.has(g.date)); if (!games.length) { console.log('lineups: no NBA games today or tomorrow'); return; }
  // ESPN events for those days (US dates: yesterday to tomorrow covers both Sydney days)
  const evs = (await Promise.all([-1, 0, 1].map((d) => getJson(`${SITE}scoreboard?dates=${ymd(now + d * 86400000)}`)))).flatMap((j) => (j && j.events) || []);
  const inj = new Map(); read('troster.json').filter((t) => t.sp === 'nba').forEach((t) => inj.set(t.code, (t.inj || []).filter((i) => OUT.test(i[3] || '')).map((i) => i[1])));
  const rows = [], done = new Set(); let conf = 0, proj = 0;
  for (const g of games) {
    const e = evs.find((x) => sydKey(x.date) === g.date && (() => { const c = x.competitions[0].competitors; const a = c.find((y) => y.homeAway === 'away'), h = c.find((y) => y.homeAway === 'home'); return code(a.team.abbreviation) + '-' + code(h.team.abbreviation) === g.id; })());
    if (!e) continue;
    const comp = e.competitions[0], state = comp.status.type.state;
    let box = null;
    if (state !== 'pre') { const s = await getJson(`${SITE}summary?event=${e.id}`); box = s && s.boxscore && s.boxscore.players; }
    for (const side of ['away', 'home']) {
      const c = comp.competitors.find((y) => y.homeAway === side), t = code(c.team.abbreviation);
      const outList = (inj.get(t) || []);
      let row = null;
      const bt = box && box.find((p) => p.team.id === String(c.team.id));
      const st = bt && bt.statistics[0] && bt.statistics[0].athletes.filter((a) => a.starter).map((a) => a.athlete.displayName);
      if (st && st.length === 5) { row = { status: 'Confirmed', starters: st.join(' · '), source: 'Actual starters (ESPN box score).', change: 'Confirmed at tip-off.' }; conf++; }
      else {
        const p = await projected(c.team.id);
        if (p) { row = { status: 'Projected', starters: p.five.join(' · '), source: 'ESPN depth chart' + (p.notes.length ? ': ' + p.notes.join('; ') : '') + '.', change: 'Projected from the depth chart (updated as players return or get hurt); the final five is confirmed at tip-off.' }; proj++; }
      }
      if (!row) continue;
      rows.push({ key: `${g.id}-${t}`, game: g.id, team: t, side: side === 'away' ? 'Away' : 'Home', ...row, out: outList.join('; ') || 'None listed', checked: checkedAt() });
      done.add(`${g.id}-${t}`);
    }
  }
  if (!rows.length) { console.log('lineups: nothing found (ESPN down?); lineups.json left as it was'); return; }
  const keep = read('lineups.json').filter((r) => !done.has(r.key));
  fs.writeFileSync(path.join(DATA, 'lineups.json'), JSON.stringify(keep.concat(rows)));
  console.log(`lineups.json: ${rows.length / 2} games updated (${proj} projected from depth charts, ${conf} confirmed at tip-off)`);
})().catch((e) => { console.error(e); process.exit(1); });
