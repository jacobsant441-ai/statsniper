// Fetches UFC fighter profiles from ESPN's public MMA feed into public/data/ufcp.json.
// Usage: npm run fetch:ufc
//
// Fighters: everyone on a UFC card from 1 Jan 2025 on, including booked future bouts.
// Each row is one fighter: profile (height, reach, age, stance, style, team), career UFC
// rates worked out from ESPN's per-fight stats, the next booked fight, and `f`, a JSON
// string listing every pro fight newest first (inside and outside the UFC), each as:
//   [date, event, ufc, opp, oppId, res, method, methodDetail, round, clock, secs, title,
//    sigL, sigA, totL, totA, kd, tdL, tdA, subAtt, oSigL, oSigA, oTdL, oTdA, oKd]
// ufc and title are 1 or 0; secs is time in the cage; the o* fields are the opponent's
// numbers from the same fight (strikes and takedowns he took). Stats are null where
// ESPN has none (most fights outside the UFC).
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'data', 'ufcp.json');
const FROM = '20250101', TO = '20271231';
const UFC_LEAGUE = 'l:3321';
const API = 'https://site.web.api.espn.com/apis/common/v3/sports/mma/athletes/';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'StatSniper/1.0' } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      if (i === tries - 1) throw new Error(url + ': ' + e.message);
      await sleep(600 * 2 ** i);
    }
  }
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}
const usDate = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const METHOD = (name) => {
  const n = String(name || '').toLowerCase();
  if (/^(t?ko)/.test(n) || n.includes('knockout')) return 'KO/TKO';
  if (n.includes('submission')) return 'SUB';
  if (n.includes('decision')) return 'DEC';
  if (n.includes('disqual') || n === 'dq') return 'DQ';
  if (n.includes('no-contest') || n.includes('no contest')) return 'NC';
  if (n.includes('draw')) return 'DRAW';
  return n ? n.toUpperCase() : '';
};
const clockSecs = (period, clock) => {
  const [m, s] = String(clock || '0:00').split(':').map(Number);
  return period ? (period - 1) * 300 + (m || 0) * 60 + (s || 0) : null;
};
const pairNum = (v) => { const [a, b] = String(v == null ? '' : v).split('/').map(Number); return [Number.isFinite(a) ? a : null, Number.isFinite(b) ? b : null]; };

// Per-fight stats keyed by event id: {sigL, sigA, totL, totA, kd, tdL, tdA, sub}
const statsCache = new Map();
async function fightStats(id) {
  if (statsCache.has(id)) return statsCache.get(id);
  const p = (async () => {
    const r = await getJson(API + id + '/stats').catch(() => null);
    const byEvent = {};
    for (const cat of (r && r.categories) || []) {
      const names = (cat.names || []).map((n) => String(n).replace(/\s+/g, ' ').trim().toLowerCase());
      const ix = (n) => names.indexOf(n);
      for (const row of cat.statistics || []) {
        const s = row.stats || [], o = byEvent[row.eventId] || (byEvent[row.eventId] = {});
        const num = (n) => { const i = ix(n); if (i < 0 || s[i] == null || s[i] === '' || s[i] === '-') return null; const v = Number(String(s[i]).replace('%', '')); return Number.isFinite(v) ? v : null; };
        const cn = String(cat.displayName || '').toLowerCase();
        if (cn === 'striking') {
          o.sigL = num('significant strikes landed'); o.sigA = num('significant strikes attempts');
          o.totL = num('strikes landed'); o.totA = num('total strikes attempts'); o.kd = num('knockdowns');
        } else if (cn === 'clinch') {
          o.tdL = num('takedowns landed'); o.tdA = num('takedowns attempted');
        } else if (cn === 'ground') {
          o.sub = num('submissions');
        }
      }
    }
    return byEvent;
  })();
  statsCache.set(id, p);
  return p;
}

(async () => {
  // 1. Fighters from UFC cards since 2025, plus each one's next booked bout.
  const sb = { events: [] };
  for (let y = Number(FROM.slice(0, 4)); y <= Number(TO.slice(0, 4)); y++) {
    const r = await getJson(`https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard?dates=${y}0101-${y}1231&limit=100`).catch(() => null);
    sb.events.push(...((r && r.events) || []));
  }
  const fighters = new Map(), next = new Map(), now = Date.now();
  for (const ev of sb.events || []) {
    for (const c of ev.competitions || []) {
      const cs = c.competitors || [];
      for (const x of cs) fighters.set(x.id, (x.athlete && x.athlete.displayName) || x.id);
      const pre = c.status && c.status.type && c.status.type.state === 'pre' && new Date(c.date).getTime() > now;
      if (pre && cs.length === 2) {
        cs.forEach((x, i) => {
          const o = cs[1 - i];
          const cur = next.get(x.id);
          if (!cur || new Date(c.date) < new Date(cur.iso)) next.set(x.id, { iso: c.date, date: usDate(c.date), event: ev.name, opp: o.athlete && o.athlete.displayName, oppId: o.id, weight: c.type && c.type.abbreviation, rounds: c.format && c.format.regulation && c.format.regulation.periods });
        });
      }
    }
  }
  const ids = [...fighters.keys()];
  console.log(`${(sb.events || []).length} UFC events, ${ids.length} fighters; fetching profiles…`);

  // 2. Profile and fight history for each fighter.
  let done = 0;
  const rows = await pool(ids, 8, async (id) => {
    try {
      const r = await getJson(API + id);
      if (!r || !r.athlete) return null;
      const a = r.athlete, own = await fightStats(id);
      const fights = [];
      for (const [uid, e] of Object.entries(r.eventsMap || {})) {
        if (!e.gameResult) continue; // future bout, or no result yet
        const ufc = uid.includes(UFC_LEAGUE) ? 1 : 0;
        const st = e.status || {}, res = (st.result || {});
        const s = own[e.id] || {};
        let o = {};
        if (ufc && e.opponent && e.opponent.id) o = (await fightStats(e.opponent.id))[e.id] || {};
        const resCode = e.gameResult === 'D' ? 'D' : e.gameResult === 'NC' ? 'NC' : e.gameResult;
        fights.push([
          usDate(e.gameDate), e.name || '', ufc, (e.opponent && e.opponent.displayName) || '', (e.opponent && e.opponent.id) || '',
          resCode, METHOD(res.name || res.displayName), res.displayName || '', st.period || null, st.displayClock || '', clockSecs(st.period, st.displayClock), e.titleFight ? 1 : 0,
          s.sigL ?? null, s.sigA ?? null, s.totL ?? null, s.totA ?? null, s.kd ?? null, s.tdL ?? null, s.tdA ?? null, s.sub ?? null,
          o.sigL ?? null, o.sigA ?? null, o.tdL ?? null, o.tdA ?? null, o.kd ?? null,
        ]);
      }
      fights.sort((x, y) => (x[0] < y[0] ? 1 : -1));
      const sum = (rec) => (rec && (rec.statistics || []).find((x) => x.name === 'wins-losses-draws') || {}).displayValue || '';
      if (++done % 50 === 0) console.log(`  ${done}/${ids.length}`);
      return {
        id, name: a.displayName, nick: a.nickname || '', rec: sum(a.statsSummary),
        wc: (a.weightClass && a.weightClass.text) || '', height: a.displayHeight || '', reach: a.displayReach || '',
        weight: a.displayWeight || '', age: a.age || null, dob: a.displayDOB || '',
        stance: (a.stance && a.stance.text) || '', style: a.displayFightingStyle || '',
        team: (a.association && a.association.name) || '', country: a.citizenship || '',
        next: next.get(id) || null, f: JSON.stringify(fights),
      };
    } catch (e) { console.warn('skip', fighters.get(id), e.message); return null; }
  });
  const out = rows.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`Wrote ${out.length} fighters to ${path.relative(process.cwd(), OUT)} (${(fs.statSync(OUT).size / 1024 / 1024).toFixed(2)} MB)`);
})().catch((e) => { console.error(e); process.exit(1); });
