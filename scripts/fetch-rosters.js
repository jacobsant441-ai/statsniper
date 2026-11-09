// Full rosters and current injuries for every team in tprof (team pages), from ESPN's public feed.
// Usage: npm run fetch:rosters   (needs public/data/tprof.json and ucl_teams.json)
//
// Writes public/data/troster.json, one row per team:
//   {sp, code, coach (NBA and NFL; ESPN's football coach data is stale), roster: [[id, name, pos, jersey, age, height, group]],
//    inj: [[id, name, pos, status, what, returnDate, date, note]]}
// group: NFL roster section ('Offense', 'Defense', 'Special teams', 'Injured reserve / out',
// 'Suspended', 'Practice squad'); football position group; NBA ''.
// Injuries: ESPN lists them for the NBA and NFL only (its football injury feed is empty), so
// football teams carry roster only; the team page shows fixture team news for them instead.
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'public', 'data');
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/';
const read = (f, d = []) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch (e) { return d; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url, { headers: { 'User-Agent': 'StatSniper/1.0' } }); if (r.status === 404) return null; if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } catch (e) { if (i === tries - 1) { console.warn('failed', url, e.message); return null; } await sleep(600 * 2 ** i); }
  }
}
async function pool(items, n, fn) { const out = new Array(items.length); let next = 0; await Promise.all(Array.from({ length: n }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } })); return out; }
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
const NFL_GROUP = { offense: 'Offense', defense: 'Defense', specialTeam: 'Special teams', injuredReserveOrOut: 'Injured reserve / out', suspended: 'Suspended', practiceSquad: 'Practice squad' };
const SOC_ORDER = ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'];

const person = (a, group) => [String(a.id), a.displayName || a.fullName, (a.position && a.position.abbreviation) || '', a.jersey || '', a.age || null, a.displayHeight || '', group || ''];

async function injuries(slug) {
  const j = await getJson(`${SITE}${slug}/injuries`);
  const byTeam = new Map();
  for (const t of (j && j.injuries) || []) {
    const list = (t.injuries || []).filter((x) => x.status && !/^active$/i.test(x.status)).map((x) => {
      const a = x.athlete || {}; const link = ((a.links || [])[0] || {}).href || ''; const id = (link.match(/\/id\/(\d+)/) || [])[1] || '';
      const d = x.details || {}; const what = [...new Set([d.type, d.detail].filter((v) => v && !/^(not specified|other)$/i.test(v)))].join(' · ');
      return [id, a.displayName || '', (a.position && a.position.abbreviation) || '', x.status, what, d.returnDate || '', (x.date || '').slice(0, 10), clip(x.shortComment, 240)];
    });
    byTeam.set(String(t.id), list);
  }
  return byTeam;
}

(async () => {
  const tprof = read('tprof.json'), ucl = read('ucl_teams.json');
  if (!tprof.length) throw new Error('tprof.json is missing: run fetch-teams.js first');
  const uclLg = new Map(ucl.map((u) => [String(u.id), u.lg]));
  const inj = { nba: await injuries('basketball/nba'), nfl: await injuries('football/nfl') };
  const slugOf = (t) => (t.sp === 'nba' ? 'basketball/nba' : t.sp === 'nfl' ? 'football/nfl' : 'soccer/' + (t.league === 'Premier League' ? 'eng.1' : t.league === 'La Liga' ? 'esp.1' : uclLg.get(String(t.id)) || 'uefa.champions'));
  let failed = 0;
  const rows = await pool(tprof, 6, async (t) => {
    let r = await getJson(`${SITE}${slugOf(t)}/teams/${t.id}/roster`);
    if ((!r || !(r.athletes || []).length) && t.sp === 'fb') r = await getJson(`${SITE}soccer/uefa.champions/teams/${t.id}/roster`);
    const ath = (r && r.athletes) || [];
    let roster = [];
    if (t.sp === 'nfl') ath.forEach((g) => (g.items || []).forEach((a) => roster.push(person(a, NFL_GROUP[g.position] || g.position))));
    else if (t.sp === 'fb') { roster = ath.map((a) => person(a, (a.position && a.position.name) || 'Other')); roster.sort((a, b) => ((SOC_ORDER.indexOf(a[6]) + 5) % 9) - ((SOC_ORDER.indexOf(b[6]) + 5) % 9) || (Number(a[3]) || 99) - (Number(b[3]) || 99)); }
    else roster = ath.map((a) => person(a, '')).sort((a, b) => (Number(a[3]) || 99) - (Number(b[3]) || 99));
    if (!roster.length) failed++;
    const c = r && r.coach && r.coach[0];
    return { sp: t.sp, code: t.code, coach: c && t.sp !== 'fb' ? [c.firstName, c.lastName].filter(Boolean).join(' ') : '', roster, inj: (inj[t.sp] && inj[t.sp].get(String(t.id))) || [] };
  });
  const out = path.join(DATA, 'troster.json');
  fs.writeFileSync(out, JSON.stringify(rows));
  const n = rows.reduce((s, r) => s + r.roster.length, 0), ni = rows.reduce((s, r) => s + r.inj.length, 0);
  console.log(`Wrote ${rows.length} teams, ${n} players, ${ni} injuries to data/troster.json (${(fs.statSync(out).size / 1024).toFixed(0)} KB)${failed ? `; ${failed} teams had no roster` : ''}`);
})().catch((e) => { console.error(e); process.exit(1); });
