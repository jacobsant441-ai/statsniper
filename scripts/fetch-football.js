// Refreshes Premier League and La Liga in StatSniper's football data from ESPN, the same way
// fetch-ucl.js does the Champions League: league table, last round's results, and every
// fixture in the next 8 days with picks (DraftKings odds blended 50/50 with a goals model
// from each club's games this season). Hand-researched head-to-head, lineups and team news
// already on a fixture are kept.
// Usage: npm run fetch:football   (then npm run fetch:ucl for the Champions League)
const U = require('./fetch-ucl.js');

const LEAGUES = [
  { name: 'Premier League', slug: 'eng.1', prefix: 'EPL' },
  { name: 'La Liga', slug: 'esp.1', prefix: 'LAL' },
];
const DAY = 86400000;

(async () => {
  const now = Date.now();
  let table = U.read('table.json'), results = U.read('results.json'), fixtures = U.read('fixtures.json');
  const checked = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', hour12: true }).format(new Date()) + ' Sydney';
  for (const L of LEAGUES) {
    // Table, keeping the names the page already uses for each club code.
    const st = await U.getJson(`https://site.api.espn.com/apis/v2/sports/soccer/${L.slug}/standings`);
    const entries = (st && st.children && st.children[0].standings.entries) || [];
    if (!entries.length) { console.warn(L.name, ': no standings, left as it was'); continue; }
    const oldNames = new Map(table.filter((r) => r.league === L.name).map((r) => [r.abbr, r.team]));
    const clubs = new Map();
    const rows = entries.map((e) => {
      const s = Object.fromEntries(e.stats.map((x) => [x.abbreviation, x.value]));
      const code = U.SOC_CODE[e.team.abbreviation] || e.team.abbreviation;
      const name = oldNames.get(code) || e.team.displayName;
      clubs.set(e.team.id, { id: e.team.id, code, name, rank: s.R, lg: L.slug });
      return { league: L.name, rank: s.R, abbr: code, team: name, played: s.GP, w: s.W, d: s.D, l: s.L, pts: s.P, ppg: s.GP ? Math.round((s.P / s.GP) * 100) / 100 : 0 };
    }).sort((a, b) => a.rank - b.rank);
    table = [...table.filter((r) => r.league !== L.name), ...rows];

    // Matches from last month to next month.
    const months = [-1, 0, 1].map((k) => { const d = new Date(); d.setMonth(d.getMonth() + k, 1); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`; });
    const events = [];
    for (const m of months) { const r = await U.getJson(`${U.SITE}${L.slug}/scoreboard?dates=${m}`).catch(() => null); events.push(...((r && r.events) || [])); }
    const sides = (e) => { const c = e.competitions[0]; const h = c.competitors.find((x) => x.homeAway === 'home'), a = c.competitors.find((x) => x.homeAway === 'away'); return { c, h, a, H: clubs.get(h.team.id), A: clubs.get(a.team.id) }; };

    const done = events.filter((e) => e.status.type.completed).sort((a, b) => (a.date < b.date ? -1 : 1));
    if (done.length) {
      const last = new Date(done[done.length - 1].date).getTime();
      const round = done.filter((e) => last - new Date(e.date).getTime() < 4 * DAY);
      results = [...results.filter((r) => r.league !== L.name), ...round.map((e) => { const { h, a, H, A } = sides(e); return { league: L.name, home: H ? H.name : h.team.displayName, away: A ? A.name : a.team.displayName, hg: Number(h.score), ag: Number(a.score), score: `${h.score}-${a.score}` }; })];
    }

    const formCache = new Map();
    const formOf = async (t) => { if (!formCache.has(t.id)) formCache.set(t.id, U.form(await U.teamGames(t))); return formCache.get(t.id); };
    const next = events.filter((e) => e.status.type.state === 'pre' && new Date(e.date).getTime() - now < 8 * DAY).sort((a, b) => (a.date < b.date ? -1 : 1));
    const fresh = [];
    for (const e of next) {
      const { c, H, A } = sides(e); if (!H || !A) continue;
      const id = `${L.prefix}-${H.code}-${A.code}`;
      fresh.push(U.buildPick(L.name, id, e, c, H, A, await formOf(H), await formOf(A), checked, fixtures.find((r) => r.id === id)));
    }
    // Replace this league's fixtures with the upcoming ones; finished games live on in the
    // history dataset (graded by grade.js) and show in Review.
    fixtures = [...fixtures.filter((r) => r.league !== L.name), ...fresh];
    console.log(`${L.name}: table ${rows.length}, last round ${results.filter((r) => r.league === L.name).length} results, ${fresh.length} fixtures in the next 8 days (${fresh.filter((x) => x.provider === 'DraftKings').length} with DraftKings odds).`);
  }
  U.write('table.json', table); U.write('results.json', results); U.write('fixtures.json', fixtures);
})().catch((e) => { console.error(e); process.exit(1); });
