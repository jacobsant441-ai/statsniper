// StatSniper: the Standings tab. Pick a sport from the dropdown:
//   NBA       East / West conference tables from the team profiles (tprof: ESPN records), games behind the leader.
//   Soccer    a second dropdown for the league (Premier League, La Liga, Champions League), from table.json.
//   NFL       the eight divisions from nfltable.json (record, points for / against per game, last 3).
//   UFC       StatSniper power rankings: our own Elo-style rating from every fight in the fighter histories (ufcp):
//             everyone starts at 1500, a win moves you up more against a highly rated opponent; UFC fights count in
//             full, other promotions at half weight. Ranked within each weight class, active fighters only (fought in
//             the last 2 years). A second dropdown filters the weight class. ESPN's official rankings feed is years
//             out of date, so these are ours, from results only.
// Every team has its logo and every fighter his photo; tap a row for the team or fighter page.
// Loaded after the main page script; uses its helpers through window.SSX.
(() => {
  const X = window.SSX; if (!X) return;
  const { el, rows, badge, bdX } = X;
  const ST = (() => { try { return { sp: 'nba', lg: 'Premier League', wc: 'Lightweight', nbav: 'conf', nflv: 'div', ...JSON.parse(localStorage.getItem('ss_st') || '{}') }; } catch (e) { return { sp: 'nba', lg: 'Premier League', wc: 'Lightweight', nbav: 'conf', nflv: 'div' }; } })();
  if (!['league', 'conf', 'div'].includes(ST.nbav)) ST.nbav = 'conf';
  if (!['league', 'conf', 'div'].includes(ST.nflv)) ST.nflv = 'div';
  const save = () => { try { localStorage.setItem('ss_st', JSON.stringify(ST)); } catch (e) { /* private mode */ } };
  const num = (v) => Number(v) || 0;
  const NBA_CONF = { East: ['ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DET', 'IND', 'MIA', 'MIL', 'NYK', 'ORL', 'PHI', 'TOR', 'WAS'], West: ['DAL', 'DEN', 'GSW', 'HOU', 'LAC', 'LAL', 'MEM', 'MIN', 'NOP', 'OKC', 'PHX', 'POR', 'SAC', 'SAS', 'UTA'] };
  const NBA_DIVS = { Atlantic: ['BOS', 'BKN', 'NYK', 'PHI', 'TOR'], Central: ['CHI', 'CLE', 'DET', 'IND', 'MIL'], Southeast: ['ATL', 'CHA', 'MIA', 'ORL', 'WAS'], Northwest: ['DEN', 'MIN', 'OKC', 'POR', 'UTA'], Pacific: ['GSW', 'LAC', 'LAL', 'PHX', 'SAC'], Southwest: ['DAL', 'HOU', 'MEM', 'NOP', 'SAS'] };
  const NFL_DIV = { 'AFC East': ['BUF', 'MIA', 'NE', 'NYJ'], 'AFC North': ['BAL', 'CIN', 'CLE', 'PIT'], 'AFC South': ['HOU', 'IND', 'JAC', 'TEN'], 'AFC West': ['DEN', 'KC', 'LV', 'LAC'],
    'NFC East': ['DAL', 'NYG', 'PHI', 'WAS'], 'NFC North': ['CHI', 'DET', 'GB', 'MIN'], 'NFC South': ['ATL', 'CAR', 'NO', 'TB'], 'NFC West': ['ARI', 'LA', 'SF', 'SEA'] };
  const LEAGUES = ['Premier League', 'La Liga', 'Champions League'];
  const WCS = ['Heavyweight', 'Light Heavyweight', 'Middleweight', 'Welterweight', 'Lightweight', 'Featherweight', 'Bantamweight', 'Flyweight', "Women's Bantamweight", "Women's Flyweight", "Women's Strawweight"];

  const select = (id, label, opts, val, on) => {
    const w = el('label', null, 'stsel'); w.append(el('span', label));
    const s = document.createElement('select'); s.id = id;
    opts.forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; if (v === val) o.selected = true; s.append(o); });
    s.addEventListener('change', () => on(s.value)); w.append(s); return w;
  };
  const table = (heads, rowsOut) => {
    const t = el('table', null, 'sttbl'); const hr = el('tr'); heads.forEach((h, i) => hr.append(el('th', h, i > 1 ? 'n' : ''))); t.append(hr);
    rowsOut.forEach((r) => t.append(r)); const w = el('div', null, 'scroll'); w.append(t); return w;
  };
  // one row: rank, logo + name (tap to open), then the numbers
  const tr = (rank, logo, name, cells, open, cls, sub) => {
    const r = el('tr', null, cls || ''); r.append(el('td', String(rank), 'rk'));
    const nm = el('td', null, 'tmn'); const b = el('span', null, 'stnm'); if (logo) b.append(logo); const tx = el('span', null, 'sttx'); tx.append(el('b', name)); if (sub) tx.append(el('small', sub)); b.append(tx); nm.append(b); r.append(nm);
    cells.forEach((c) => r.append(el('td', c == null ? '–' : String(c), 'n')));
    if (open) { r.classList.add('go'); r.addEventListener('click', open); }
    return r;
  };
  const head = (t) => el('h3', t, 'sth');

  // NBA views: whole league, both conferences, one conference, or the six divisions
  function nba() {
    const T = rows('tprof').filter((t) => t.sp === 'nba'); if (!T.length) return [el('p', 'NBA standings are loading.', 'muted')];
    const rec = (codes) => T.filter((t) => codes.includes(t.code)).map((t) => { const [w, l] = String(t.record || '0-0').split('-').map(num); return { t, w, l, pct: w + l ? w / (w + l) : 0 }; }).sort((a, b) => b.pct - a.pct || b.w - a.w);
    const block = (title, codes, cuts) => { const list = rec(codes), lead = list[0];
      return [head(title), table(['#', 'Team', 'W', 'L', 'PCT', 'GB'], list.map((x, i) => tr(i + 1, badge(x.t.code), x.t.short || x.t.name, [x.w, x.l, x.pct.toFixed(3).replace(/^0/, ''), i ? ((lead.w - x.w + x.l - lead.l) / 2).toFixed(1).replace(/\.0$/, '') : '–'], () => X.openTeam('nba', x.t.code), cuts && i === 5 ? 'cut' : cuts && i === 9 ? 'cut2' : '')))]; };
    const v = ST.nbav, out = [];
    if (v === 'league') out.push(...block('Whole league', [...NBA_CONF.East, ...NBA_CONF.West]));
    else if (v === 'East' || v === 'West') out.push(...block(v + 'ern Conference', NBA_CONF[v], true));
    else if (v === 'div') Object.entries(NBA_DIVS).forEach(([d, c]) => out.push(...block(d + ' Division', c)));
    else Object.entries(NBA_CONF).forEach(([c, codes]) => out.push(...block(c + 'ern Conference', codes, true)));
    if (v === 'conf' || v === 'East' || v === 'West') out.push(el('p', 'Top 6 go straight to the playoffs (line under 6th); 7th to 10th play the play-in (line under 10th).', 'muted'));
    return out;
  }
  function soccer() {
    const T = rows('table').filter((t) => t.league === ST.lg).sort((a, b) => num(a.rank) - num(b.rank)); if (!T.length) return [el('p', 'No table for ' + ST.lg + ' yet.', 'muted')];
    const hasT = (code) => rows('tprof').some((t) => t.sp === 'fb' && t.code === code);
    const cut = ST.lg === 'Premier League' ? [4, 17] : ST.lg === 'La Liga' ? [4, 17] : [8, 24];
    const note = ST.lg === 'Champions League' ? 'Top 8 go straight to the last 16 (line under 8th); 9th to 24th play the knockout play-offs (line under 24th).' : 'Top 4 qualify for the Champions League (line under 4th); the bottom 3 are relegated (line under 17th).';
    return [head(ST.lg), table(['#', 'Team', 'P', 'W', 'D', 'L', 'Pts'], T.map((t) => tr(t.rank, bdX(t.abbr), t.team, [t.played, t.w, t.d, t.l, t.pts], hasT(t.abbr) ? () => X.openTeam('fb', t.abbr) : null, num(t.rank) === cut[0] ? 'cut' : num(t.rank) === cut[1] ? 'cut2' : ''))), el('p', note, 'muted')];
  }
  // NFL views: whole league, both conferences, one conference, or the eight divisions
  function nfl() {
    const T = rows('nfltable'); if (!T.length) return [el('p', 'NFL standings are loading.', 'muted')];
    const conf = (c) => Object.entries(NFL_DIV).filter(([d]) => d.startsWith(c)).flatMap(([, x]) => x);
    const block = (title, codes) => { const list = T.filter((t) => codes.includes(t.team)).map((t) => { const [w, l, d] = String(t.record || '0-0').split('-').map(num); return { t, w, l, pct: w + l + (d || 0) ? (w + 0.5 * (d || 0)) / (w + l + (d || 0)) : 0 }; }).sort((a, b) => b.pct - a.pct || num(b.t.margin) - num(a.t.margin));
      return [head(title), table(['#', 'Team', 'W-L', 'PF', 'PA', 'Diff', 'Last 3'], list.map((x, i) => tr(i + 1, bdX(x.t.team), String(x.t.name).split(' ').slice(-1)[0], [x.t.record, x.t.pf, x.t.pa, (num(x.t.margin) > 0 ? '+' : '') + x.t.margin, x.t.l3], () => X.openTeam('nfl', x.t.team))))]; };
    const v = ST.nflv, out = [];
    if (v === 'league') out.push(...block('Whole league', Object.values(NFL_DIV).flat()));
    else if (v === 'conf') ['AFC', 'NFC'].forEach((c) => out.push(...block(c, conf(c))));
    else if (v === 'AFC' || v === 'NFC') out.push(...block(v, conf(v)));
    else Object.entries(NFL_DIV).forEach(([d, c]) => out.push(...block(d, c)));
    out.push(el('p', 'Points for and against are per game this season.', 'muted'));
    return out;
  }
  // ---- UFC power rankings (Elo-style), cached until the fighter data changes
  let elo = null, eloGen = null;
  function ufcRatings() {
    const P = rows('ufcp'); if (!P.length) return null;
    if (elo && eloGen === P) return elo;
    const byId = new Map(P.map((r) => [String(r.id), r])), seen = new Set(), fights = [];
    P.forEach((r) => { let f = r.f; if (typeof f === 'string') { try { f = JSON.parse(f); } catch (e) { f = []; } } (f || []).forEach((x) => {
      const opp = String(x[4] || ''); if (!opp || !/^[WLD]$/.test(x[5])) return;
      const k = [x[0], ...[String(r.id), opp].sort()].join('|'); if (seen.has(k)) return; seen.add(k);
      fights.push({ d: x[0], a: String(r.id), b: opp, res: x[5], ufc: Number(x[2]) === 1 || x[2] === true, nc: /NC/.test(x[6] || ''), title: Number(x[11]) === 1 });
    }); });
    fights.sort((x, y) => String(x.d).localeCompare(String(y.d)));
    const R = new Map(), last = new Map(), K = 40;
    const g = (id) => (R.has(id) ? R.get(id) : 1500);
    fights.forEach((f) => {
      if (f.nc) return;
      const ra = g(f.a), rb = g(f.b), ea = 1 / (1 + Math.pow(10, (rb - ra) / 400)), sa = f.res === 'W' ? 1 : f.res === 'L' ? 0 : 0.5, k = f.ufc ? K : K / 2;
      R.set(f.a, ra + k * (sa - ea)); R.set(f.b, rb + k * ((1 - sa) - (1 - ea)));
      last.set(f.a, f); last.set(f.b, f);
    });
    // champion of each weight class: the winner of the most recent UFC title fight in that class (his current class)
    const champ = {};
    fights.filter((f) => f.title && f.ufc && !f.nc && (f.res === 'W' || f.res === 'L')).forEach((f) => { const w = f.res === 'W' ? f.a : f.b, wr = byId.get(w); if (wr && wr.wc && (!champ[wr.wc] || f.d >= champ[wr.wc].d)) champ[wr.wc] = { id: w, d: f.d }; });
    elo = { R, last, byId, champ }; eloGen = P; return elo;
  }
  function ufc() {
    const E = ufcRatings(); if (!E) return [el('p', 'UFC fighters are loading.', 'muted')];
    const cutoff = new Date(Date.now() - 2 * 365 * 86400000).toISOString().slice(0, 10);
    const champs = new Set(rows('ufcfights').flatMap((f) => [f.a, f.b]).filter((n) => /\(c\)/.test(n || '')).map((n) => n.replace(/\s*\(c\)/, '').trim()));
    const ch = E.champ[ST.wc] && E.byId.get(E.champ[ST.wc].id);
    const list = rows('ufcp').filter((r) => r.wc === ST.wc && E.R.has(String(r.id)) && E.last.get(String(r.id)) && String(E.last.get(String(r.id)).d) >= cutoff && (!ch || String(r.id) !== String(ch.id)))
      .map((r) => ({ r, rt: E.R.get(String(r.id)) })).sort((a, b) => b.rt - a.rt).slice(0, 15);
    if (ch) list.unshift({ r: ch, rt: E.R.get(String(ch.id)) || 1500, champ: true });
    if (!list.length) return [el('p', 'No active fighters on file for ' + ST.wc + '.', 'muted')];
    const lastTxt = (r) => { const f = E.last.get(String(r.id)); if (!f) return ''; const me = f.a === String(r.id); const res = me ? f.res : f.res === 'W' ? 'L' : f.res === 'L' ? 'W' : 'D'; const o = E.byId.get(me ? f.b : f.a); return res + ' vs ' + (o ? String(o.name).split(' ').slice(-1)[0] : '?'); };
    return [head(ST.wc + ' · power rankings'), table(['#', 'Fighter', 'Record', 'Rating'], list.map((x, i) => tr(x.champ ? 'C' : ch ? i : i + 1, X.avatar ? X.avatar('ufc', x.r.id, x.r.name, 'stav') : null, x.r.name + (x.champ ? ' (champion)' : ''), [x.r.rec, Math.round(x.rt)], X.openFighter ? () => X.openFighter(x.r.id) : null, x.champ ? 'champ' : '', 'Last fight: ' + lastTxt(x.r)))),
      el('p', 'StatSniper power rankings, our own and not the official UFC list: an Elo-style rating from every pro fight on file (UFC fights count in full, other promotions at half weight). Beating a highly rated fighter moves you up more. Active fighters only (a fight in the last 2 years). C is the champion: the winner of the most recent UFC title fight in the division.', 'muted')];
  }

  dash.draw('standings', (box) => {
    const ctl = el('div', null, 'stctl');
    ctl.append(select('st-sport', 'Sport', [['nba', 'NBA'], ['fb', 'Soccer'], ['nfl', 'NFL'], ['ufc', 'UFC']], ST.sp, (v) => { ST.sp = v; save(); dash.draw('standings'); }));
    if (ST.sp === 'nba') ctl.append(select('st-nbav', 'View', [['league', 'Whole league'], ['conf', 'East & West'], ['div', 'Divisions']], ST.nbav, (v) => { ST.nbav = v; save(); dash.draw('standings'); }));
    if (ST.sp === 'nfl') ctl.append(select('st-nflv', 'View', [['league', 'Whole league'], ['conf', 'AFC & NFC'], ['div', 'Divisions']], ST.nflv, (v) => { ST.nflv = v; save(); dash.draw('standings'); }));
    if (ST.sp === 'fb') ctl.append(select('st-league', 'League', LEAGUES.map((l) => [l, l]), ST.lg, (v) => { ST.lg = v; save(); dash.draw('standings'); }));
    if (ST.sp === 'ufc') ctl.append(select('st-wc', 'Weight class', WCS.map((w) => [w, w]), ST.wc, (v) => { ST.wc = v; save(); dash.draw('standings'); }));
    const body = ST.sp === 'nba' ? nba() : ST.sp === 'fb' ? soccer() : ST.sp === 'nfl' ? nfl() : ufc();
    box.replaceChildren(ctl, ...body);
  });
})();
