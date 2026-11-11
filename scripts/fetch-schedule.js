// Every upcoming game for the next 30 days (NBA, NFL, Premier League, La Liga, Champions League) from ESPN's
// free scoreboard, into public/data/schedule.json. The page lists them on their Sydney day as "Scheduled ·
// picks to come" until the evening job builds that day's stats (nba-slate.js, nfl-week.js, fetch-football.js),
// and team pages / player profiles use them for "next game". No keys, no private data.
// Usage: node scripts/fetch-schedule.js [days=30]
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'public', 'data');
const DAYS = Number(process.argv[2] || 30);
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/';
const NBA_CODE = { GS: 'GSW', NO: 'NOP', NY: 'NYK', SA: 'SAS', UTAH: 'UTA', WSH: 'WAS' };
const NFL_CODE = { JAX: 'JAC', LAR: 'LA', WSH: 'WAS' };
const LEAGUES = [
  { sp: 'nba', path: 'basketball/nba' },
  { sp: 'nfl', path: 'football/nfl' },
  { sp: 'fb', path: 'soccer/eng.1', league: 'Premier League' },
  { sp: 'fb', path: 'soccer/esp.1', league: 'La Liga' },
  { sp: 'fb', path: 'soccer/uefa.champions', league: 'Champions League' },
];
const sydKey = (iso) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', weekday: 'short', day: 'numeric', month: 'short' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value])); return `${p.weekday} ${p.day} ${p.month}`; };
const sydTime = (iso) => new Date(iso).toLocaleTimeString('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', minute: '2-digit' }).toUpperCase();
const ymd = (t) => new Date(t).toISOString().slice(0, 10).replace(/-/g, '');
async function getJson(url) {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(url, { headers: { 'User-Agent': 'StatSniper/1.0' } }); if (r.ok) return await r.json(); } catch (e) { /* retry */ }
    await new Promise((res) => setTimeout(res, 1500));
  }
  return null;
}

(async () => {
  const now = Date.now(), out = [], seen = new Set();
  let fails = 0;
  for (const L of LEAGUES) {
    // ESPN dates are US dates; start a day back so this morning's Sydney games (last night US) are included.
    const dates = Array.from({ length: DAYS + 1 }, (_, i) => ymd(now + (i - 1) * 86400000));
    for (let i = 0; i < dates.length; i += 6) {
      const res = await Promise.all(dates.slice(i, i + 6).map((d) => getJson(`${SITE}${L.path}/scoreboard?dates=${d}`)));
      for (const j of res) {
        if (!j) { fails++; continue; }
        for (const e of j.events || []) {
          const c = e.competitions && e.competitions[0]; if (!c) continue;
          const st = (c.status || e.status || {}).type || {};
          if (st.state && st.state !== 'pre') continue; // live or finished: grade.js / history handle those
          if (new Date(e.date).getTime() < now - 3 * 3600000) continue;
          const A = c.competitors.find((x) => x.homeAway === 'away'), H = c.competitors.find((x) => x.homeAway === 'home'); if (!A || !H) continue;
          const map = L.sp === 'nba' ? NBA_CODE : L.sp === 'nfl' ? NFL_CODE : {};
          const ac = map[A.team.abbreviation] || A.team.abbreviation, hc = map[H.team.abbreviation] || H.team.abbreviation;
          const id = L.sp === 'fb' ? 'FB-' + e.id : ac + '-' + hc;
          const key = L.sp + '|' + id + '|' + e.date; if (seen.has(key)) continue; seen.add(key);
          out.push({
            sport: L.sp, ...(L.league ? { league: L.league } : {}), date: sydKey(e.date), id, away: ac, home: hc,
            away_name: L.sp === 'nba' ? A.team.shortDisplayName : A.team.displayName, home_name: L.sp === 'nba' ? H.team.shortDisplayName : H.team.displayName,
            kick: sydTime(e.date), iso: e.date, status: 'Scheduled',
          });
        }
      }
    }
  }
  if (!out.length) { console.error('No games found (ESPN down?); schedule.json left as it was.'); process.exit(1); }
  out.sort((a, b) => (a.iso < b.iso ? -1 : 1));
  fs.writeFileSync(path.join(DATA, 'schedule.json'), JSON.stringify(out));
  const by = {}; out.forEach((x) => { const k = x.league || x.sport.toUpperCase(); by[k] = (by[k] || 0) + 1; });
  console.log(`schedule.json: ${out.length} upcoming games over ${DAYS} days (${Object.entries(by).map(([k, v]) => k + ' ' + v).join(', ')})` + (fails ? `; ${fails} ESPN requests failed` : ''));
})().catch((e) => { console.error(e); process.exit(1); });
