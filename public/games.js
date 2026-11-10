// StatSniper: main play for NBA and NFL games, Best bets on Home, My bets in Review.
// Loaded after the main page script; uses its helpers through window.SSX (each script file runs in its own scope).
//
// Main play: of the bets we can put a chance on (winner, spread, total), the one with the highest
// chance by our research that pays at least $1.40. Prices are the best Australian price (odds.json)
// when a bookmaker offers that bet, else the US price ESPN shows (DraftKings), else an estimate.
// Chances for spreads and totals come from our projected margin and total (normal spread: NBA 12 / 17
// points, NFL 13.5 / 13), at whatever line the price is for.
(() => {
  const X = window.SSX; if (!X) return;
  const { el, rows, badge, bdX } = X;
  const MIN_PRICE = 1.4;
  const phi = (z) => { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2); const q = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - q : q; };
  const amDec = (s) => { const m = String(s || '').match(/([+-]\d+)\s*$/); if (!m) return null; const a = Number(m[1]); return Math.round((a > 0 ? 1 + a / 100 : 1 + 100 / -a) * 100) / 100; };
  const conf = (c) => (c >= 70 ? 'High' : c >= 60 ? 'Medium' : 'Low');
  const fmtPt = (p) => (p > 0 ? '+' + p : String(p));
  const SIG = { nba: { m: 12, t: 17 }, nfl: { m: 13.5, t: 13 } };

  // Every bet we can rate for one NBA or NFL game: [{market, pick, chance, price, book, est}]
  function candidates(sp, id) {
    const odds = rows('odds').filter((o) => o.sp === sp && o.game === id);
    const out = [];
    let H, A, mh, proj, winP, posted, total, mlH, mlA;
    if (sp === 'nba') {
      const p = rows('pred').find((x) => x.id === id), g = rows('games').find((x) => x.id === id); if (!p || !g) return [];
      [A, H] = String(g.matchup || '').split(' @ ');
      mh = (p.winner === g.home ? 1 : -1) * Number(p.margin || 0); proj = Number(p.proj_total);
      const pickHome = p.ml_pick === g.home; winP = { [H]: pickHome ? p.ml_final_prob : 100 - p.ml_final_prob, [A]: pickHome ? 100 - p.ml_final_prob : p.ml_final_prob };
      posted = p.posted_margin; total = Number(g.total);
      const pr = amDec(p.ml_price); mlH = pickHome ? pr : null; mlA = pickHome ? null : pr;
    } else {
      const g = rows('nflgames').find((x) => x.id === id); if (!g) return [];
      H = g.home_name; A = g.away_name; mh = Number(g.proj_home) - Number(g.proj_away); proj = Number(g.proj_total);
      winP = { [H]: g.home_pct, [A]: g.away_pct }; posted = g.spread_home != null ? -Number(g.spread_home) : null; total = Number(g.total);
      mlH = g.ml_home != null ? amDec((g.ml_home > 0 ? '+' : '') + g.ml_home) : null; mlA = g.ml_away != null ? amDec((g.ml_away > 0 ? '+' : '') + g.ml_away) : null;
    }
    const s = SIG[sp];
    // winner
    for (const [nm, us] of [[H, mlH], [A, mlA]]) {
      const au = odds.find((o) => o.market === 'Winner' && o.pick === nm + ' win');
      if (winP[nm] == null) continue;
      out.push({ market: 'Winner', pick: nm + ' win', chance: Number(winP[nm]), price: au ? au.price : us, book: au ? au.book : us ? 'DraftKings (US)' : null, est: !au && !us });
    }
    // spread: Australian lines if offered, else the posted line at a standard price
    const sps = odds.filter((o) => o.market === 'Spread');
    if (sps.length) sps.forEach((o) => { const home = o.pick.startsWith(H + ' '); const mT = home ? mh : -mh; out.push({ market: 'Spread', pick: o.pick, chance: 100 * phi((mT + Number(o.point)) / s.m), price: o.price, book: o.book }); });
    else if (posted != null && Number.isFinite(mh)) { const hc = 100 * phi((mh - posted) / s.m); const home = hc >= 50; out.push({ market: 'Spread', pick: (home ? H + ' ' + fmtPt(-posted) : A + ' ' + fmtPt(posted)), chance: home ? hc : 100 - hc, price: 1.91, book: null, est: true }); }
    // total
    const tts = odds.filter((o) => o.market === 'Total points');
    if (tts.length) tts.forEach((o) => { const ov = 100 * phi((proj - Number(o.point)) / s.t); out.push({ market: 'Total', pick: o.pick, chance: /^Over/.test(o.pick) ? ov : 100 - ov, price: o.price, book: o.book }); });
    else if (Number.isFinite(total) && Number.isFinite(proj)) { const ov = 100 * phi((proj - total) / s.t); out.push({ market: 'Total', pick: (ov >= 50 ? 'Over ' : 'Under ') + total, chance: Math.max(ov, 100 - ov), price: 1.91, book: null, est: true }); }
    return out.filter((c) => Number.isFinite(c.chance)).map((c) => ({ ...c, chance: Math.round(c.chance) }));
  }
  const pickMain = (list) => { const ok = list.filter((c) => c.price && c.price >= MIN_PRICE).sort((a, b) => b.chance - a.chance); return ok[0] || list.slice().sort((a, b) => (b.price || 0) - (a.price || 0))[0] || null; };
  const priceTxt = (c) => (!c.price ? 'no price yet' : (c.est ? '≈ $' : '$') + c.price.toFixed(2) + (c.book && !c.est ? ' · ' + c.book : c.est ? ' (estimated)' : ''));

  // Main play card for an NBA or NFL game page.
  function mainCard(sp, id) {
    const list = candidates(sp, id); const m = pickMain(list); if (!m) return null;
    const card = el('div', null, 'card gpcard'); card.append(el('h2', 'Main play'));
    const top = el('div', null, 'gptop'); top.append(el('b', m.pick, 'gpk'), el('span', m.chance + '% chance · ' + conf(m.chance), 'gpp'), el('span', priceTxt(m), 'gppr' + (m.price < MIN_PRICE ? ' low' : '')));
    card.append(top);
    const safest = list.slice().sort((a, b) => b.chance - a.chance)[0];
    if (safest && safest !== m) card.append(el('p', 'Safest bet: ' + safest.pick + ' (' + safest.chance + '%, ' + priceTxt(safest) + ').', 'gpsafe'));
    const tiles = el('div', null, 'gpall');
    ['Winner', 'Spread', 'Total'].forEach((mk) => { const best = list.filter((c) => c.market === mk).sort((a, b) => b.chance - a.chance)[0]; if (!best) return; const d = el('div'); d.append(el('span', mk), el('b', best.pick), el('small', best.chance + '% · ' + (best.price ? (best.est ? '≈$' : '$') + best.price.toFixed(2) : '–'))); tiles.append(d); });
    card.append(tiles);
    return card;
  }

  // Football: the goals main play already on the fixture.
  const fbMain = (x) => { const g = x.goals_play; return g ? { market: 'Goals', pick: g.pick, chance: g.pct, price: g.price, book: g.book, est: g.est } : null; };

  // ---- Best bets on Home: the strongest main plays for today (Sydney), or the next day with games.
  const dayKey = (d) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', weekday: 'short', day: 'numeric', month: 'short' }).formatToParts(d).map((x) => [x.type, x.value])); return `${p.weekday} ${p.day} ${p.month}`; };
  function bestBets() {
    const items = [];
    rows('games').forEach((g) => { if (rows('pred').some((p) => p.id === g.id)) items.push({ sp: 'nba', id: g.id, day: g.date, match: g.matchup, time: g.time }); });
    rows('fixtures').forEach((f) => items.push({ sp: 'fb', id: f.id, day: String(f.time).split(',')[0], match: f.home + ' v ' + f.away, time: (String(f.time).split(', ')[1] || '').replace(' AEDT', ''), x: f }));
    rows('nflgames').forEach((g) => items.push({ sp: 'nfl', id: g.id, day: String(g.kick).split(',')[0], match: g.away_name + ' @ ' + g.home_name, time: String(g.kick).split(', ')[1] || '' }));
    const now = new Date();
    // Only games still to start: not graded or live in history, kick-off still ahead (Sydney time).
    const kickAt = (i) => { const m = String(i.day + ' ' + i.time).match(/(\d+) (\w{3}) (\d+:\d+) ?([ap]m)/i); return m ? new Date(Date.parse(`${m[1]} ${m[2]} ${now.getFullYear()} ${m[3]} ${m[4].toUpperCase()} GMT+1100`)) : null; };
    const done = new Set(rows('history').filter((h) => h.status === 'Final' || h.status === 'Live').map((h) => (h.sport || 'nba') + '|' + h.id + '|' + h.date));
    const ahead = items.filter((i) => !done.has(i.sp + '|' + i.id + '|' + i.day) && (() => { const k = kickAt(i); return !k || isNaN(k) || k.getTime() > now.getTime(); })());
    items.length = 0; items.push(...ahead);
    const aheadIds = new Set(ahead.map((i) => i.sp + '|' + i.id + '|' + i.day));
    // From 4 pm Sydney the card shows the next day's best bets (today's left-overs only if tomorrow has none).
    const hr = Number(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', hourCycle: 'h23' }).format(now)) % 24;
    // One day only: today, or tomorrow from 4 pm (or when today has nothing left). Never further ahead.
    const groups = [];
    for (const k of hr >= 16 ? [1, 0] : [0, 1]) {
      const key = dayKey(new Date(now.getTime() + k * 86400000));
      const today = items.filter((i) => i.day === key);
      const plays = today.map((i) => { const m = i.sp === 'fb' ? fbMain(i.x) : pickMain(candidates(i.sp, i.id)); return m ? { ...i, m } : null; }).filter((i) => i && i.m.price >= MIN_PRICE);
      // Our own milestone props (propPlays, prop finder) are hidden from Best bets (owner, 10 Nov): only bookie
      // props with real AU prices show. To bring them back: const props = propPlays(today.filter((i) => i.sp === 'nba'));
      const props = [];
      const bprops = bookPlays(key, aheadIds);
      if (plays.length || props.length || bprops.length) { groups.push({ key, plays: plays.sort((a, b) => b.m.chance - a.m.chance), props, bprops }); break; }
    }
    return groups;
  }
  // NBA player props with a real bookmaker line: in if he cleared it in 65%+ of his games this season (5+ games)
  // and the price is $1.40 or more. One side per player and stat.
  const PROP_MIN = 65, STAT_W = { PTS: 'points', REB: 'rebounds', AST: 'assists', '3PM': 'threes', PRA: 'pts + reb + ast' };
  // Prop finder (scripts/prop-finder.js): our own chance from the player's game logs; one row per player and
  // stat at the highest milestone we give 75%+. A bookmaker price is attached when a matching line is saved
  // (Mac only); otherwise the fair price is shown with ≈.
  // Bookmaker prop lines with real AU prices (propbook, Mac only: fetch-props.js then prop-finder.js): our
  // chance for the exact line at 65%+ and paying $1.30+. Bookies set main lines near 50/50, so 75%+ is rare.
  // With alternate lines (fetch-props.js --alt) there are plenty at 75%+; one per player and stat (the safest).
  const BOOK_MIN = 75, BOOK_PRICE = 1.3;
  // NBA and NFL (sp on each row); only games still to start; one line per player and stat (our highest chance).
  function bookPlays(key, aheadIds) {
    const now = Date.now(), seen = new Set(), out = [];
    rows('propbook').filter((r) => r.day === key && num(r.chance) >= BOOK_MIN && num(r.price) >= BOOK_PRICE && (r.kick ? new Date(r.kick).getTime() > now : aheadIds.has((r.sp || 'nba') + '|' + r.game + '|' + r.day)))
      .sort((a, b) => num(b.chance) - num(a.chance)).forEach((r) => {
        const k = (r.sp || 'nba') + '|' + r.player + '|' + r.stat; if (seen.has(k)) return; seen.add(k);
        const g = rows('games').find((x) => x.id === r.game && x.date === r.day);
        const time = r.kick ? new Date(r.kick).toLocaleTimeString('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', minute: '2-digit' }) : '';
        out.push({ sp: r.sp || 'nba', id: r.game, day: r.day, match: (r.sp || 'nba') === 'nba' && g ? g.matchup : r.game.replace('-', ' @ '), time, prop: true, m: { market: 'Prop', pick: r.pick, chance: Math.round(num(r.chance)), rank: num(r.chance), price: num(r.price), book: r.book, est: false, hit: r.hit, finder: r } });
      });
    return out;
  }
  function propPlays(nba) {
    const out = [], seen = new Set();
    rows('propfind').forEach((r) => {
      const g = nba.find((i) => i.id === r.game && i.day === r.day); if (!g) return;
      const book = rows('props').find((q) => q.game === r.game && q.player === r.player && q.stat === r.stat && num(q.line) === r.line - 0.5 && num(q.over) > 1);
      seen.add(r.player + '|' + r.stat);
      out.push({ ...g, prop: true, m: { market: 'Prop', pick: r.pick, chance: Math.round(num(r.chance)), rank: num(r.chance), price: book ? num(book.over) : num(r.fair), book: book ? book.over_book : '', est: !book, hit: r.hit, finder: r } });
    });
    return out;
  }
  // Older rule (bookmaker lines cleared 65%+ this season): replaced by the prop finder on 10 Nov after it
  // went 57/108; kept for reference.
  function propPlaysBook(nba) {
    const out = [];
    rows('props').forEach((q) => {
      const g = nba.find((i) => i.id === q.game); if (!g || !(num(q.n) >= 5)) return;
      const sides = [['Over', num(q.over), q.over_book, num(q.over_hit), num(q.over_pct)], ['Under', num(q.under), q.under_book, num(q.under_hit), num(q.under_pct)]]
        .filter(([, pr, , , pct]) => pct >= PROP_MIN && pr >= MIN_PRICE).sort((a, b) => b[4] - a[4]);
      if (!sides.length) return;
      const [side, price, book, hit, pct] = sides[0], n = num(q.n);
      out.push({ ...g, prop: true, m: { market: 'Prop', pick: q.player + ' ' + side.toLowerCase() + ' ' + q.line + ' ' + (STAT_W[q.stat] || q.stat), chance: pct, rank: Math.round((100 * (hit + 1)) / (n + 2)), price, book, est: false, hit: hit + '/' + n } });
    });
    return out;
  }
  const bbRow = (i) => {
    const b = el('button', null, 'bbr'); b.type = 'button';
    const ic = el('span', null, 'bbic'); const src = window.TAB_ICONS && window.TAB_ICONS[i.sp]; if (src) { const im = document.createElement('img'); im.src = src; im.alt = ''; ic.append(im); }
    const f = i.m.finder;
    const sub = f ? `Hit ${f.hit} this season · avg ${f.avg}, last ${f.sp === 'nfl' ? 3 : 5} ${f.l5}${f.why && f.why.length ? ' · ' + f.why[0] : ''} · ${i.match}` : (i.m.hit ? 'Hit ' + i.m.hit + ' this season · ' : '') + i.match + (i.time ? ' · ' + i.time : '');
    const l = el('div', null, 'l'); l.append(el('b', i.m.pick), el('span', sub));
    const r = el('div', null, 'r'); r.append(el('b', i.m.chance + '%', 'c ' + conf(i.m.chance)), el('span', (i.m.est ? '≈$' : '$') + i.m.price.toFixed(2) + (i.m.book && !i.m.est ? ' ' + i.m.book.replace(' (AU)', '') : '')));
    b.append(ic, l, r); b.addEventListener('click', () => (f && f.side && window.SSPP ? window.SSPP.focus(i.sp, f.stat, f.line, f.player, f.pid) : X.openGame(i.sp, i.id, i.day)));
    return b;
  };
  const bbReady = () => ['games', 'pred', 'fixtures', 'odds', 'propfind', 'propbook'].every((d) => dash.data(d).status !== 'loading');
  dash.draw('bestbets', (box) => {
    if (!bbReady()) { box.replaceChildren(el('p', 'Loading…', 'plnone')); return; }
    const groups = bestBets(), g = groups[0];
    if (!g) { box.replaceChildren(el('p', 'No priced plays for today or tomorrow yet.', 'plnone')); return; }
    const out = [el('div', g.key, 'bbday')];
    if (g.plays.length) out.push(el('div', 'Game props', 'bbday bbsub'), ...g.plays.slice(0, 3).map(bbRow));
    if (g.bprops && g.bprops.length) out.push(el('div', 'Player props · our chance 75%+ at $1.30+', 'bbday bbsub'), ...g.bprops.slice(0, 3).map(bbRow));
    if (g.props.length) out.push(el('div', 'Player props · our chance 75%+', 'bbday bbsub'), ...g.props.slice(0, 3).map(bbRow));
    const n = groups.reduce((t, x) => t + x.plays.length + x.props.length + (x.bprops ? x.bprops.length : 0), 0);
    const more = el('button', 'See all ' + n + ' best bets ›', 'bbmore'); more.type = 'button';
    more.addEventListener('click', () => X.openBets()); out.push(more);
    box.replaceChildren(...out);
  });
  // Best bets page: every play at $1.40 or more, by day, best chance first.
  dash.draw('bestall', (box) => {
    if (!bbReady()) { box.replaceChildren(el('p', 'Loading…', 'plnone')); return; }
    const groups = bestBets();
    if (!groups.length) { box.replaceChildren(el('p', 'No priced plays for today or tomorrow yet.', 'plnone')); return; }
    const out = [];
    groups.forEach((g) => {
      out.push(el('div', g.key, 'bbday'));
      if (g.plays.length) { out.push(el('div', 'Game props · ' + g.plays.length, 'bbday bbsub'), el('p', 'Winner, line and total for each game: our best play at $1.40 or more.', 'muted bbnote')); out.push(...g.plays.map(bbRow)); }
      if (g.bprops && g.bprops.length) { out.push(el('div', 'Player props · ' + g.bprops.length, 'bbday bbsub'), el('p', 'Real Australian bookie lines (NBA and NFL) where our chance is 75%+ and the price is $1.30+, one line per player and stat. Our chance comes from his game logs; tested on this season, lines we rate 75%+ hit about 80% (NBA) and 77-91% depending on the stat (NFL). A big gap to the bookie can mean they know something (minutes, late injury news). Tap one to open the player.', 'muted bbnote')); out.push(...g.bprops.map(bbRow)); }
      if (g.props.length) { const top = g.props.slice(0, 30); out.push(el('div', 'Player props · ' + g.key + ' · top ' + top.length + ' of ' + g.props.length, 'bbday bbsub'), el('p', 'Our chance from each player\'s game logs: season average plus recent form, out players removed. Tested on every game day this season using only earlier games: plays at 75%+ hit 81%. ≈ is our fair price (no bookmaker line saved); take it only if the bookie pays more. Reasons like home/away or the opponent are shown but did not improve the chance in testing, so they do not move it.', 'muted bbnote')); out.push(...top.map(bbRow)); }
    });
    box.replaceChildren(...out);
  });

  // ---- My bets in Review: bets the owner logs in chat (dataset bets), settled from results.
  // ---- My bets: open bets on Home; once settled they move to Review with a profit / loss bar.
  const num = (x) => Number(x || 0);
  const isBonus = (b) => b.bonus === true || b.bonus === 'true';
  const money = (v) => (Math.abs(v) < 0.005 ? '$0.00' : (v > 0 ? '+$' : '−$') + Math.abs(v).toFixed(2));
  // Bonus bets: a win pays the winnings only, a loss costs nothing.
  const profitOf = (b) => (b.status === 'won' ? num(b.stake) * (num(b.price) - 1) : b.status === 'lost' ? (isBonus(b) ? 0 : -num(b.stake)) : 0);
  const betRows = () => { const g = dash.data('bets'); return g.status === 'ok' && Array.isArray(g.data) ? g.data.filter((b) => b.status !== 'placeholder') : []; };
  const isOpen = (b) => !b.status || b.status === 'open';
  // The live app may hand nested lists over as text or as an object: always give an array of legs (or null).
  const legsOf = (b) => { let l = b && b.legs; if (l == null || l === '') return null; if (typeof l === 'string') { try { l = JSON.parse(l); } catch (e) { return null; } } if (!Array.isArray(l)) l = typeof l === 'object' ? Object.values(l) : null; return l && l.length ? l : null; };
  // Stats for the Home corner: bets placed, record of settled bets, profit (settled) and cash still running.
  const betStats = () => {
    const all = betRows(), settled = all.filter((b) => b.status === 'won' || b.status === 'lost');
    const won = settled.filter((b) => b.status === 'won').length;
    return { n: all.length, won, lost: settled.length - won, profit: settled.reduce((s, b) => s + profitOf(b), 0), running: all.filter((b) => isOpen(b) && !isBonus(b)).reduce((s, b) => s + num(b.stake), 0) };
  };
  const betPill = () => {
    const st = betStats(); if (!st.n) return null;
    // Main figure: cash back minus cash in, counting stakes on open bets as spent until they win.
    const net = st.profit - st.running;
    const b = el('button', null, 'betpill ' + (net > 0 ? 'up' : net < 0 ? 'dn' : '')); b.type = 'button'; b.title = 'My bet results';
    b.append(el('span', st.n + (st.n === 1 ? ' bet' : ' bets') + ' · ' + st.won + '-' + st.lost, 'bpr'), el('b', money(net), 'bpp'), el('span', st.running ? 'incl. $' + st.running.toFixed(2) + ' on open bets' : 'all settled', 'bprun'));
    b.addEventListener('click', () => X.openBetResults());
    return b;
  };
  const legIcon = (s) => el('span', s === 'won' ? '✓' : s === 'lost' ? '✕' : s === 'void' ? '–' : '•', 'mbi ' + (s || 'open'));
  const betCard = (b) => {
    const legs = legsOf(b);
    const r = el('div', null, 'mbr ' + (b.status || 'open') + (legs ? ' multi' : ''));
    const top = el('div', null, 'mbt'), l = el('div');
    const title = legs ? legs.length + ' leg ' + ((b.sgm === true || b.sgm === 'true') ? 'same game multi' : 'multi') + ' @ $' + num(b.price).toFixed(2) : b.pick + ' @ $' + num(b.price).toFixed(2);
    l.append(el('b', title), el('span', [legs ? null : b.match, (isBonus(b) ? 'Bonus bet $' : '$') + num(b.stake).toFixed(2), b.settled || b.placed].filter(Boolean).join(' · ')));
    const pays = isBonus(b) ? num(b.stake) * (num(b.price) - 1) : num(b.stake) * num(b.price);
    const res = b.status === 'won' || (b.status === 'lost' && !isBonus(b)) ? money(profitOf(b)) : b.status === 'lost' ? '$0.00' : b.status === 'void' ? 'Void' : 'Pays $' + pays.toFixed(2);
    const rr = el('div', null, 'v'); rr.append(el('b', res), el('span', b.status === 'won' ? 'Won' : b.status === 'lost' ? (isBonus(b) ? 'Lost · bonus bet' : 'Lost') : b.status === 'void' ? 'Void' : 'Open'));
    top.append(l, rr); r.append(top);
    if (legs) {
      const ul = el('div', null, 'mblegs');
      legs.forEach((x) => { const d = el('div', null, 'mbleg ' + (x.status || 'open')); const tx = el('div'); tx.append(el('b', x.pick + (num(x.price) ? ' @ ' + num(x.price).toFixed(2) : '')), el('span', x.final || (x.group ? x.match + ' · ' + x.group : x.match))); d.append(legIcon(x.status), tx); ul.append(d); });
      r.append(el('span', legs.filter((x) => x.status === 'won').length + ' of ' + legs.length + ' legs landed', 'mbcount'), ul);
    }
    return r;
  };
  dash.draw('mybets', (box) => {
    const open = betRows().filter(isOpen).reverse();
    if (!open.length) { box.replaceChildren(el('p', 'No open bets. Send Claude a screenshot of a bet and it shows here; settled bets move to Review.', 'plnone')); return; }
    const pot = open.reduce((s, b) => s + (isBonus(b) ? num(b.stake) * (num(b.price) - 1) : num(b.stake) * num(b.price)), 0);
    const st = el('div', null, 'ppst');
    const cell = (lab, v) => { const d = el('div'); d.append(el('span', lab), el('b', v)); return d; };
    st.append(cell('Open bets', String(open.length)), cell('Staked', '$' + open.reduce((s, b) => s + num(b.stake), 0).toFixed(2)), cell('Could pay', '$' + pot.toFixed(2)));
    const t = el('div', null, 'mbl'); open.forEach((b) => t.append(betCard(b)));
    box.replaceChildren(st, t);
  });
  // Collapsed My bets header on Home: a one-line summary; tap to slide the bets down.
  dash.draw('mybetsum', (box) => {
    const open = betRows().filter(isOpen);
    if (!open.length) { box.textContent = 'No open bets'; return; }
    const pot = open.reduce((s, b) => s + (isBonus(b) ? num(b.stake) * (num(b.price) - 1) : num(b.stake) * num(b.price)), 0);
    box.textContent = open.length + ' open · could pay $' + pot.toFixed(2);
  });
  // Review: folded header line for settled bets
  dash.draw('mybetsrvsum', (box) => {
    const done = betRows().filter((b) => b.status === 'won' || b.status === 'lost');
    if (!done.length) { box.textContent = 'None settled yet'; return; }
    const won = done.filter((b) => b.status === 'won').length, pr = done.reduce((s, b) => s + profitOf(b), 0);
    box.textContent = won + '-' + (done.length - won) + ' · ' + money(pr); box.className = 'mbsum ' + (pr > 0 ? 'up' : pr < 0 ? 'dn' : '');
  });
  // Review: settled bets, newest first, each with a bar out from the middle (green right = profit, red left = loss).
  dash.draw('mybetsrv', (box) => {
    const done = betRows().filter((b) => !isOpen(b)).reverse();
    if (!done.length) { box.replaceChildren(el('p', 'No settled bets yet. Bets move here from Home once every leg is decided.', 'plnone')); return; }
    const settled = done.filter((b) => b.status === 'won' || b.status === 'lost');
    const profit = settled.reduce((s, b) => s + profitOf(b), 0), won = settled.filter((b) => b.status === 'won').length;
    const cashIn = settled.filter((b) => !isBonus(b)).reduce((s, b) => s + num(b.stake), 0);
    const st = el('div', null, 'ppst');
    const cell = (lab, v, c) => { const d = el('div', null, c || ''); d.append(el('span', lab), el('b', v)); return d; };
    st.append(cell('Record', won + '-' + (settled.length - won)), cell('Profit', money(profit), profit > 0 ? 'up' : profit < 0 ? 'dn' : ''), cell('Return', cashIn ? Math.round((100 * profit) / cashIn) + '%' : '–'));
    // Running total bar
    const max = Math.max(1, ...done.map((b) => Math.abs(profitOf(b))), Math.abs(profit));
    const bar = (v, label, sub, big) => {
      const row = el('div', null, 'plrow' + (big ? ' tot' : ''));
      const lab = el('div', null, 'pll'); lab.append(el('b', label), el('span', sub || ''));
      const track = el('div', null, 'pltrack'); const fill = el('div', null, 'plfill ' + (v > 0 ? 'up' : v < 0 ? 'dn' : 'zero'));
      const w = Math.max(v ? 2 : 0, (50 * Math.abs(v)) / max); fill.style.width = w + '%'; fill.style[v >= 0 ? 'left' : 'right'] = '50%';
      track.append(el('i', null, 'plmid'), fill);
      row.append(lab, track, el('b', money(v), 'plv ' + (v > 0 ? 'up' : v < 0 ? 'dn' : ''))); return row;
    };
    const bars = el('div', null, 'plbars');
    bars.append(bar(profit, 'All settled bets', settled.length + (settled.length === 1 ? ' bet' : ' bets'), true));
    done.forEach((b) => bars.append(bar(profitOf(b), legsOf(b) ? legsOf(b).length + ' leg ' + ((b.sgm === true || b.sgm === 'true') ? 'SGM' : 'multi') + ' @ $' + num(b.price).toFixed(2) : b.pick, [b.settled || b.placed, isBonus(b) ? 'bonus bet' : null].filter(Boolean).join(' · '))));
    const det = document.createElement('details'); det.className = 'moredet mbdet'; det.append(el('summary', 'Bet details (' + done.length + ')'));
    const t = el('div', null, 'mbl'); done.forEach((b) => t.append(betCard(b))); det.append(t);
    box.replaceChildren(st, bars, det);
  });


  // ---- Live: scores, box scores and how our picks are tracking, from BigQuery (datasets livegames, livebox),
  // written every minute during games by the statsniper-live Cloud Function. The page reads them when it
  // opens and whenever a game is opened or Refresh is tapped.
  ['livegames', 'livebox'].forEach((id) => dash.loader(id, { description: 'BigQuery’s answer as rows', fn: ({ answer, read }) => read.bigquery(answer) }));
  const liveRows = (id) => { const g = dash.data(id); return g.status === 'ok' && Array.isArray(g.data) ? g.data : []; };
  const nrm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\b(fc|cf|ac|as|sc|fk|sk|afc|club|de|cp|rc|vfb|vfl|rb|ssc)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const nsim = (a, b) => { a = nrm(a); b = nrm(b); return !!a && !!b && (a === b || a.includes(b) || b.includes(a)); };
  const refreshLive = () => { try { dash.refresh('livegames'); dash.refresh('livebox'); } catch (e) { /* not connected */ } };
  // The live row for one of our games: NBA / NFL by id, football by team names.
  function liveOf(sp, ref) {
    const rs = liveRows('livegames').filter((r) => r.sport === sp);
    if (sp === 'fb') return rs.find((r) => nsim(r.home_name, ref.home) && nsim(r.away_name, ref.away)) || null;
    return rs.filter((r) => r.game_id === ref).sort((a, b) => String(b.start_time).localeCompare(String(a.start_time)))[0] || null;
  }
  const stateTxt = (r) => (r.state === 'in' ? 'LIVE · ' + r.status_text : r.state === 'post' ? (r.status_text || 'Final').toUpperCase() : '');
  const sc = (v) => (v == null ? 0 : Number(v));

  // Game card: live score in place of the start time, with LIVE / FINAL.
  function liveDecor(b, sp, ref) {
    b.addEventListener('click', refreshLive);
    const r = liveOf(sp, ref); if (!r || r.state === 'pre') return;
    const st = b.querySelector('.mid strong'), pre = b.querySelector('.mid .pre');
    if (st) st.textContent = sc(r.away_score) + ' – ' + sc(r.home_score);
    if (pre) { pre.textContent = stateTxt(r); pre.classList.add(r.state === 'in' ? 'lvon' : 'lvdone'); }
  }

  // Home page cards: the live score and status for a game that is on (or just finished but not graded yet).
  function liveHome(b, sp, ref) {
    const r = liveOf(sp, ref); if (!r || r.state === 'pre') return;
    const tm = b.querySelector('.tm'); if (!tm) return;
    const score = sc(r.away_score) + '-' + sc(r.home_score);
    const txt = (r.state === 'in' ? 'LIVE · ' + r.status_text : 'FT') + ' · ' + (sp === 'fb' ? sc(r.home_score) + '-' + sc(r.away_score) : score);
    const tn = [...tm.childNodes].reverse().find((n) => n.nodeType === 3); // keep the league badge
    if (tn) tn.textContent = txt; else tm.textContent = txt;
    b.classList.add(r.state === 'in' ? 'lvon' : 'lvdone');
  }

  // How our main play stands right now.
  function playStatus(sp, m, r) {
    if (!m || !r) return null;
    const hs = sc(r.home_score), as = sc(r.away_score), tot = hs + as, ov = String(m.pick).match(/^(Over|Under) ([\d.]+)/);
    let ok = null, txt = '';
    if (ov) { const L = Number(ov[2]); ok = ov[1] === 'Over' ? tot > L : tot < L; txt = tot + ' ' + (sp === 'fb' ? (tot === 1 ? 'goal' : 'goals') : 'points') + ' so far' + (ov[1] === 'Over' && !ok ? ', needs ' + (Math.floor(L) + 1 - tot) + ' more' : ''); }
    else if (/^(Both score|Not both)$/.test(m.pick)) { const both = hs > 0 && as > 0; ok = m.pick === 'Both score' ? both : !both; txt = both ? 'both teams have scored' : hs || as ? 'one team has scored' : 'no goals yet'; }
    else if (/ win$/.test(m.pick)) { const home = nsim(m.pick.replace(/ win$/, ''), r.home_name); const d = home ? hs - as : as - hs; ok = d > 0; txt = d > 0 ? 'leading by ' + d : d < 0 ? 'trailing by ' + -d : 'level'; }
    else { const sm = String(m.pick).match(/^(.*) ([+-][\d.]+)$/); if (sm) { const home = nsim(sm[1], r.home_name); const d = (home ? hs - as : as - hs) + Number(sm[2]); ok = d > 0; txt = (d > 0 ? 'covering by ' : 'short by ') + Math.abs(d); } }
    if (ok == null) return null;
    const done = r.state === 'post';
    const p = el('p', null, 'lvplay ' + (ok ? 'ok' : 'no'));
    p.append(el('b', (done ? (ok ? '✓ ' : '✕ ') : '') + 'Main play ' + m.pick), document.createTextNode(': ' + (done ? (ok ? 'won' : 'lost') + ' · ' : '') + txt + '.'));
    return p;
  }

  // Live card at the top of a game page.
  function liveCard(sp, ref) {
    const r = liveOf(sp, ref); if (!r || r.state === 'pre') return null;
    const card = el('div', null, 'card lvcard'); const h = el('h2', 'Live'); card.append(h);
    const top = el('div', null, 'lvtop');
    const fbn = sp === 'fb';
    const side = (name, s) => { const d = el('div', null, 'lvs'); d.append(el('span', name), el('b', String(sc(s)))); return d; };
    // same sides as the game page header: football home on the left, NBA / NFL away on the left
    const L = fbn ? [r.home_name, r.home_score] : [r.away_name, r.away_score], R = fbn ? [r.away_name, r.away_score] : [r.home_name, r.home_score];
    top.append(side(...L), el('span', stateTxt(r), 'lvst ' + (r.state === 'in' ? 'on' : 'done')), side(...R));
    card.append(top);
    const rb = el('button', 'Refresh', 'lvref'); rb.type = 'button'; rb.addEventListener('click', (e) => { e.stopPropagation(); refreshLive(); }); card.append(rb);
    const m = sp === 'fb' ? fbMain(ref) : pickMain(candidates(sp, ref)); const ps = playStatus(sp, m, r); if (ps) card.append(ps);
    // quarter / half scores
    let ls = []; try { ls = JSON.parse(r.linescore || '[]'); } catch (e) { ls = []; }
    if (ls.length && !fbn) {
      const t = el('table', null, 'lvls'); const hr = el('tr'); hr.append(el('th', '')); ls.forEach((q, i) => hr.append(el('th', i < 4 ? 'Q' + (i + 1) : 'OT' + (i - 3)))); hr.append(el('th', 'T')); t.append(hr);
      [[r.away_code, 1, r.away_score], [r.home_code, 0, r.home_score]].forEach(([c, k, tot]) => { const tr = el('tr'); tr.append(el('td', c)); ls.forEach((q) => tr.append(el('td', q[k] == null ? '–' : String(q[k])))); tr.append(el('td', String(sc(tot)), 'tot')); t.append(tr); });
      card.append(t);
    }
    if (fbn) { // goals, cards and team stats
      let x = {}; try { x = JSON.parse(r.extra || '{}'); } catch (e) { x = {}; }
      if ((x.events || []).length) { const ul = el('div', null, 'lvev'); x.events.forEach((e) => { const d = el('div'); d.append(el('span', e.t, 't'), el('span', /goal|penalty - scored/i.test(e.type) ? '⚽' : /red/i.test(e.type) ? '🟥' : '🟨', 'i'), el('span', e.text)); ul.append(d); }); card.append(ul); }
      const H = (x.teams || []).find((t) => t.ha === 'home'), A = (x.teams || []).find((t) => t.ha === 'away');
      if (H && A) { const t = el('table', null, 'lvls lvst2'); [['Possession %', 'possessionPct'], ['Shots', 'totalShots'], ['On target', 'shotsOnTarget'], ['Corners', 'wonCorners'], ['Yellow cards', 'yellowCards'], ['Red cards', 'redCards']].forEach(([l, k]) => { const tr = el('tr'); tr.append(el('td', H.st[k] ?? '–', 'n'), el('td', l), el('td', A.st[k] ?? '–', 'n')); t.append(tr); }); card.append(t); }
    } else { // player box score
      const box = liveRows('livebox').filter((b) => b.espn_id === r.espn_id);
      const props = sp === 'nba' ? rows('props').filter((p) => p.game === ref) : [];
      [r.away_code, r.home_code].forEach((team) => {
        const pl = box.filter((b) => b.team === team).map((b) => { let s = {}; try { s = JSON.parse(b.stats || '{}'); } catch (e) { s = {}; } return { ...b, s }; });
        if (!pl.length) return;
        card.append(el('h3', team, 'lvteam'));
        const t = el('table', null, 'lvbox');
        if (sp === 'nba') {
          const hr = el('tr'); ['Player', 'MIN', 'PTS', 'REB', 'AST', '3PM'].forEach((x, i) => hr.append(el('th', x, i ? 'n' : ''))); t.append(hr);
          pl.filter((p) => !p.s.dnp).sort((a, b) => (String(b.starter) === 'true' ? 1 : 0) - (String(a.starter) === 'true' ? 1 : 0) || Number(b.s.points || 0) - Number(a.s.points || 0)).forEach((p) => {
            const tr = el('tr'); const nm = el('td'); nm.append(el('b', p.player));
            const pts = Number(p.s.points || 0), cur = { PTS: pts, REB: Number(p.s.rebounds || 0), AST: Number(p.s.assists || 0), '3PM': Number(String(p.s['threePointFieldGoalsMade-threePointFieldGoalsAttempted'] || '0-0').split('-')[0]) };
            props.filter((q) => nrm(q.player) === nrm(p.player) && cur[q.stat] != null).forEach((q) => nm.append(el('small', cur[q.stat] + '/' + q.line + ' ' + q.stat, 'lvprop ' + (cur[q.stat] > q.line ? 'hit' : 'pend'))));
            tr.append(nm, el('td', String(p.s.minutes ?? '–'), 'n'), el('td', String(pts), 'n'), el('td', String(p.s.rebounds ?? '–'), 'n'), el('td', String(p.s.assists ?? '–'), 'n'), el('td', String(String(p.s['threePointFieldGoalsMade-threePointFieldGoalsAttempted'] || '0-0').split('-')[0]), 'n'));
            t.append(tr);
          });
        } else { // NFL: the leading passer, rushers and receivers
          const lead = (k, n) => pl.filter((p) => p.s[k] != null).sort((a, b) => Number(b.s[k]) - Number(a.s[k])).slice(0, n);
          const hr = el('tr'); ['Player', 'Line'].forEach((x, i) => hr.append(el('th', x, i ? 'n' : ''))); t.append(hr);
          const add = (p, txt) => { const tr = el('tr'); tr.append(el('td', p.player), el('td', txt, 'n')); t.append(tr); };
          lead('passing.passingYards', 1).forEach((p) => add(p, (p.s['passing.completions/passingAttempts'] || '') + ' · ' + p.s['passing.passingYards'] + ' yds · ' + (p.s['passing.passingTouchdowns'] || 0) + ' TD'));
          lead('rushing.rushingYards', 2).forEach((p) => add(p, p.s['rushing.rushingAttempts'] + ' car · ' + p.s['rushing.rushingYards'] + ' yds' + (Number(p.s['rushing.rushingTouchdowns']) ? ' · ' + p.s['rushing.rushingTouchdowns'] + ' TD' : '')));
          lead('receiving.receivingYards', 3).forEach((p) => add(p, p.s['receiving.receptions'] + ' rec · ' + p.s['receiving.receivingYards'] + ' yds' + (Number(p.s['receiving.receivingTouchdowns']) ? ' · ' + p.s['receiving.receivingTouchdowns'] + ' TD' : '')));
        }
        const w = el('div', null, 'scroll'); w.append(t); card.append(w);
      });
    }
    card.append(el('p', 'Updated ' + new Date(r.updated_at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: 'Australia/Sydney' }), 'lvupd'));
    return card;
  }

  // ---- Swipe back: a swipe to the right returns to the page you were on before (page history in the page
  // script); with no history it does what the page's Back button does. Rows that scroll sideways (tabs, strips, tables) keep their own swipes.
  (() => {
    let x0 = 0, y0 = 0, t0 = 0, ok = false;
    const scrollsX = (n) => { for (; n && n !== document.body; n = n.parentElement) { const cs = getComputedStyle(n); if (/(auto|scroll)/.test(cs.overflowX) && n.scrollWidth > n.clientWidth + 2) return true; } return false; };
    const backBtn = () => [...document.querySelectorAll('.backbtn')].find((b) => b.offsetParent !== null && b.getClientRects().length);
    const hint = el('div', '‹', 'swback'); document.body.append(hint);
    document.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) { ok = false; return; }
      const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; t0 = Date.now();
      ok = (X.navDepth && X.navDepth() > 0 || !!backBtn()) && (x0 < 40 || !scrollsX(e.target));
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
      if (!ok) return; const t = e.touches[0], dx = t.clientX - x0, dy = Math.abs(t.clientY - y0);
      if (dy > 40 && dy > dx) { ok = false; hint.style.opacity = 0; return; }
      if (dx > 20) { hint.style.opacity = Math.min(1, dx / 110); hint.style.transform = 'translate(' + Math.min(dx / 3, 36) + 'px,-50%)'; }
    }, { passive: true });
    document.addEventListener('touchend', (e) => {
      const was = ok; ok = false; hint.style.opacity = 0; hint.style.transform = '';
      if (!was) return; const t = e.changedTouches[0], dx = t.clientX - x0, dy = Math.abs(t.clientY - y0);
      if (dx > 90 && dy < 60 && dx > 2 * dy && Date.now() - t0 < 900) { if (!(X.navBack && X.navBack())) { const b = backBtn(); if (b) b.click(); } }
    }, { passive: true });
  })();

  // ---- NBA defence by court zone (pbp team rows): what each defence allows in the restricted area, the rest of
  // the paint, mid-range, both corner threes and above-the-break threes, on a half court coloured by league rank.
  const ZONES = [['ra', 'Restricted area'], ['paint', 'Paint'], ['mid', 'Mid-range'], ['lc', 'Left corner 3'], ['rc', 'Right corner 3'], ['atb', 'Above-break 3']];
  const zoneTable = () => {
    const T = rows('pbp').filter((r) => r.k === 't'); if (!T.length) return null;
    const pct = (z) => (z && z[0] ? z[1] / z[0] : null);
    const lg = {}, rk = {};
    ZONES.forEach(([k]) => {
      const a = T.reduce((s, t) => s + ((t.z && t.z[k] && t.z[k][0]) || 0), 0), m = T.reduce((s, t) => s + ((t.z && t.z[k] && t.z[k][1]) || 0), 0);
      lg[k] = a ? m / a : null;
      const order = T.filter((t) => pct(t.z && t.z[k]) != null).sort((x, y) => pct(x.z[k]) - pct(y.z[k])); // 1 = lowest FG% allowed (best)
      rk[k] = Object.fromEntries(order.map((t, i) => [t.team, i + 1]));
    });
    return { T, lg, rk, n: T.length, pct };
  };
  const tier = (r, n) => (r <= Math.round(n / 3) ? 'g' : r > Math.round((2 * n) / 3) ? 'r' : 'a');
  const COL = { g: '#1f9d55', a: '#c9971a', r: '#d64545' };
  function courtSvg(team, Z) {
    const t = Z.T.find((x) => x.team === team); if (!t) return null;
    const c = (k) => COL[tier(Z.rk[k][team] || Z.n, Z.n)];
    const lab = (k, x, y, size) => { const r = Z.rk[k][team], p = Z.pct(t.z[k]); return '<text x="' + x + '" y="' + y + '" font-size="' + (size || 22) + '" text-anchor="middle" fill="#fff" font-weight="700">' + (p == null ? '–' : Math.round(p * 100) + '%') + '</text><text x="' + x + '" y="' + (y + (size || 22) * 0.95) + '" font-size="' + Math.round((size || 22) * 0.7) + '" text-anchor="middle" fill="#fff" opacity=".9">#' + r + '</text>'; };
    // half court, baseline at the top: 500 x 470 = 50 x 47 ft; basket 5.25 ft out; 3pt arc 23.75 ft; corners 22 ft, 14 ft deep
    return '<svg viewBox="0 0 500 470" class="dcourt" role="img" aria-label="Opponent shooting by zone">' +
      '<rect x="0" y="0" width="500" height="470" fill="' + c('atb') + '"/>' +
      '<rect x="0" y="0" width="30" height="142" fill="' + c('lc') + '"/><rect x="470" y="0" width="30" height="142" fill="' + c('rc') + '"/>' +
      '<path d="M30 0 V142 A237.5 237.5 0 0 0 470 142 V0 Z" fill="' + c('mid') + '"/>' +
      '<rect x="170" y="0" width="160" height="190" fill="' + c('paint') + '"/>' +
      '<path d="M210 0 V52.5 A40 40 0 0 0 290 52.5 V0 Z" fill="' + c('ra') + '"/>' +
      '<g fill="none" stroke="rgba(255,255,255,.85)" stroke-width="3"><rect x="1.5" y="1.5" width="497" height="467"/><path d="M30 0 V142 A237.5 237.5 0 0 0 470 142 V0"/><rect x="170" y="0" width="160" height="190"/><path d="M210 0 V52.5 A40 40 0 0 0 290 52.5 V0"/><circle cx="250" cy="190" r="60"/><line x1="220" y1="40" x2="280" y2="40"/><circle cx="250" cy="52.5" r="7.5"/></g>' +
      lab('ra', 250, 80, 18) + lab('paint', 250, 150) + lab('mid', 250, 262, 18) + lab('lc', 16, 70, 12) + lab('rc', 484, 70, 12) + lab('atb', 250, 410) +
      '</svg>';
  }
  function defCourt(id) {
    const Z = zoneTable(); if (!Z) return null;
    const teams = String(id).split('-').filter((c) => Z.T.some((t) => t.team === c)); if (!teams.length) return null;
    const card = el('div', null, 'card dcard'); card.append(el('h2', 'Defence by court zone'));
    card.append(el('p', 'What each defence allows from every part of the court this season: opponents\' field goal % (rank of 30, #1 = toughest). Green is a strength, red is where they are weakest.', 'muted'));
    const tog = el('div', null, 'nblut'), panes = [];
    const show = (i) => { panes.forEach((p, j) => { p.hidden = j !== i; }); tog.querySelectorAll('button').forEach((b, j) => b.classList.toggle('on', j === i)); };
    teams.forEach((team, i) => {
      const t = Z.T.find((x) => x.team === team), pane = el('div', null, 'dpane');
      const order = ZONES.map(([k, l]) => ({ k, l, r: Z.rk[k][team], p: Z.pct(t.z[k]), a: t.z[k] ? t.z[k][0] : 0 })).filter((z) => z.p != null);
      const weak = order.filter((z) => z.r > Z.n / 2).sort((x, y) => y.r - x.r).slice(0, 2), strong = order.slice().sort((x, y) => x.r - y.r)[0];
      pane.append(el('p', (weak.length ? 'Weakest: ' : 'No weak spot (every zone in the top half)') + weak.map((z) => z.l.replace(/ \(.*\)/, '').toLowerCase() + ' (' + Math.round(z.p * 100) + '% allowed, #' + z.r + ')').join(' and ') + '. Toughest: ' + strong.l.replace(/ \(.*\)/, '').toLowerCase() + ' (' + Math.round(strong.p * 100) + '%, #' + strong.r + ').', 'dsum'));
      const svg = el('div', null, 'dsvg'); svg.innerHTML = courtSvg(team, Z); pane.append(svg);
      const tb = el('table', null, 'dtbl'); const hr = el('tr'); ['Zone', 'Allowed', 'League', 'Shots', 'Rank'].forEach((h, j) => hr.append(el('th', h, j ? 'n' : ''))); tb.append(hr);
      order.forEach((z) => { const tr = el('tr'); const rkc = el('td', null, 'n'); rkc.append(el('span', '#' + z.r, 'drk ' + tier(z.r, Z.n))); tr.append(el('td', z.l), el('td', Math.round(z.p * 100) + '%', 'n'), el('td', Z.lg[z.k] != null ? Math.round(Z.lg[z.k] * 100) + '%' : '–', 'n'), el('td', (z.a / (t.n || 1)).toFixed(1), 'n'), rkc); tb.append(tr); });
      const w = el('div', null, 'scroll'); w.append(tb); pane.append(w);
      pane.append(el('p', 'From every shot in ESPN play-by-play this season (' + t.n + ' games). Small samples early in the season.', 'muted'));
      const b = el('button', null); b.type = 'button'; b.append(X.badge(team), document.createTextNode(team)); b.addEventListener('click', (e) => { e.stopPropagation(); show(i); }); tog.append(b);
      panes.push(pane); card.append(pane);
    });
    card.append(tog); show(0);
    return card;
  }


  // ---- Instant results: a game that is full time in the live feed is graded right away in the browser, with the
  // same rules as scripts/grade.js. The cloud grades it officially a few minutes later and its row replaces ours.
  const nday = (d) => String(d || '').replace(/^(\w+) 0(\d) /, '$1 $2 ').trim();
  const tHit = (lean, total, line) => { if (!Number.isFinite(total) || !Number.isFinite(Number(line)) || !/over|under/i.test(lean || '')) return ''; if (total === Number(line)) return 'push'; return (/over/i.test(lean) ? total > line : total < line) ? 'hit' : 'miss'; };
  const tkn = (h) => (h === 'hit' ? '✓' : h === 'miss' ? '✗' : '');
  const NOTE = ' Graded from the live final score; the official grade confirms it shortly.';
  function provisional(off) {
    const hist = [], fin = [];
    const have = new Set(off.filter((h) => h.status === 'Final').map((h) => (h.sport || 'nba') + '|' + h.id + '|' + nday(h.date)));
    const post = liveRows('livegames').filter((r) => r.state === 'post');
    post.filter((r) => r.sport === 'nba').forEach((r) => {
      const day = dayKey(new Date(r.start_time)), id = r.game_id; if (have.has('nba|' + id + '|' + day)) return;
      const g = rows('games').find((x) => x.id === id && nday(x.date) === day), p = rows('pred').find((x) => x.id === id); if (!g || !p || g.away !== r.away_code || g.home !== r.home_code) return;
      const ap = sc(r.away_score), hp = sc(r.home_score), [an, hn] = String(p.matchup || g.matchup || '').split(' @ '), win = ap > hp ? g.away : g.home;
      const row = { sport: 'nba', date: day, id, away: g.away, home: g.home, away_name: an || g.away, home_name: hn || g.home, kick: String(g.time || '').toLowerCase(), status: 'Final', away_pts: ap, home_pts: hp, pick: p.ml_pick || p.winner, pick_pct: p.ml_final_prob, conf: p.combined_conf || p.confidence, total_lean: p.total_lean, posted_total: p.posted_total != null ? p.posted_total : g.total, proj_total: p.proj_total, winner_hit: '', total_hit: '', auto: true, provisional: true };
      row.winner_hit = win === row.pick ? 'hit' : 'miss'; row.total_hit = tHit(row.total_lean, ap + hp, row.posted_total);
      row.verdict = tkn(row.winner_hit) + ' Picked ' + row.pick + ' (' + row.pick_pct + '%, ' + row.conf + '): ' + win + ' won ' + Math.max(ap, hp) + '-' + Math.min(ap, hp) + '.' + (row.total_hit ? ' ' + tkn(row.total_hit) + ' ' + row.total_lean + ' ' + row.posted_total + ': total was ' + (ap + hp) + '.' : '') + NOTE;
      row.factors = p.margin != null ? ['Margin: we projected ' + p.winner + ' by ' + p.margin + '; actual ' + win + ' by ' + Math.abs(ap - hp) + '.'] : [];
      hist.push(row); fin.push({ id, status: 'Final', away_pts: ap, home_pts: hp, note: '', date: day, provisional: true });
    });
    post.filter((r) => r.sport === 'nfl').forEach((r) => {
      const g = rows('nflgames').find((x) => x.id === r.game_id); if (!g) return;
      const day = nday(String(g.kick).split(',')[0]); if (have.has('nfl|' + g.id + '|' + day)) return;
      const ap = sc(r.away_score), hp = sc(r.home_score), win = ap > hp ? g.away : hp > ap ? g.home : 'TIE';
      const row = { sport: 'nfl', date: day, id: g.id, away: g.away, home: g.home, away_name: g.away_name, home_name: g.home_name, kick: String(g.kick).split(',').slice(1).join(',').trim(), status: 'Final', away_pts: ap, home_pts: hp, pick: g.pick, pick_pct: g.pick_pct, conf: g.conf, total_lean: g.total_lean, posted_total: g.total, proj_total: g.proj_total, spread_pick: g.cover_pick || g.ats_pick || '', spread_home: g.spread_home, winner_hit: win === g.pick ? 'hit' : 'miss', total_hit: tHit(g.total_lean, ap + hp, g.total), spread_hit: '', auto: true, provisional: true };
      if (row.spread_pick && Number.isFinite(Number(g.spread_home))) { const ats = hp + Number(g.spread_home) - ap; row.spread_hit = ats === 0 ? 'push' : (ats > 0 ? g.home : g.away) === row.spread_pick ? 'hit' : 'miss'; }
      row.verdict = tkn(row.winner_hit) + ' Picked ' + g.pick + ' (' + g.pick_pct + '%, ' + g.conf + '): ' + (win === 'TIE' ? 'tie' : win + ' won') + ' ' + Math.max(ap, hp) + '-' + Math.min(ap, hp) + '.' + (row.total_hit ? ' ' + tkn(row.total_hit) + ' ' + g.total_lean + ' ' + g.total + ': total ' + (ap + hp) + '.' : '') + (row.spread_hit ? ' ' + tkn(row.spread_hit) + ' Spread pick ' + row.spread_pick + '.' : '') + NOTE;
      row.factors = g.proj_home != null ? ['Score: we projected ' + g.home + ' ' + g.proj_home + ' - ' + g.away + ' ' + g.proj_away + '; final ' + g.home + ' ' + hp + ' - ' + g.away + ' ' + ap + '.'] : [];
      hist.push(row);
    });
    const table = rows('table');
    const codeOf = (name, league) => { const t = table.find((q) => q.team === name && q.league === league) || table.find((q) => q.team === name); return t ? t.abbr : String(name).slice(0, 3).toUpperCase(); };
    rows('fixtures').forEach((x) => {
      const r = post.find((q) => q.sport === 'fb' && nsim(q.home_name, x.home) && nsim(q.away_name, x.away)); if (!r) return;
      const day = nday(String(x.time).split(',')[0]); if (have.has('fb|' + x.id + '|' + day)) return;
      const hc = codeOf(x.home, x.league), ac = codeOf(x.away, x.league), hg = sc(r.home_score), ag = sc(r.away_score), tot = hg + ag, both = hg > 0 && ag > 0;
      const pickSide = /draw/i.test(x.pick) ? 'Draw' : x.pick.indexOf(x.home) === 0 ? hc : ac, resSide = hg > ag ? hc : ag > hg ? ac : 'Draw';
      const row = { sport: 'fb', league: x.league, date: day, id: x.id, away: ac, home: hc, away_name: x.away, home_name: x.home, kick: String(x.time).split(',').slice(1).join(',').replace(/\s*AEDT/, '').trim().toLowerCase(), status: 'Final', away_pts: ag, home_pts: hg, pick: pickSide, pick_text: x.pick, pick_pct: x.pick_pct, conf: x.confidence, gp_pick: x.goals_play && x.goals_play.pct ? x.goals_play.pick : '', gp_pct: x.goals_play ? x.goals_play.pct : null, gp_hit: '', btts_pick: x.btts_pick, p_btts: x.p_btts, ou_pick: x.ou_pick, p_o25: x.p_o25, total_lean: /over|under/i.test(x.ou_pick) ? x.ou_pick : 'Coin toss', posted_total: 2.5, proj_total: x.xg_total, proj_score: x.proj_score, winner_hit: resSide === pickSide ? 'hit' : 'miss', total_hit: '', btts_hit: '', auto: true, provisional: true };
      if (row.gp_pick) { const ok = { 'Over 1.5': tot > 1, 'Under 1.5': tot < 2, 'Over 2.5': tot > 2, 'Under 2.5': tot < 3, 'Over 3.5': tot > 3, 'Under 3.5': tot < 4, 'Both score': both, 'Not both': !both }[row.gp_pick]; row.gp_hit = ok == null ? '' : ok ? 'hit' : 'miss'; }
      row.btts_hit = /^(Both score|Not both)$/.test(x.btts_pick || '') ? ((x.btts_pick === 'Both score') === both ? 'hit' : 'miss') : '';
      row.total_hit = tHit(row.total_lean.replace(' 2.5', ''), tot, 2.5);
      row.verdict = (row.gp_hit ? tkn(row.gp_hit) + ' Main play ' + row.gp_pick + ' (' + row.gp_pct + '%). ' : '') + tkn(row.winner_hit) + ' Picked ' + x.pick + ' (' + x.pick_pct + '%, ' + x.confidence + '): finished ' + x.home + ' ' + hg + '-' + ag + ' ' + x.away + '. ' + (row.btts_hit ? tkn(row.btts_hit) + ' ' + x.btts_pick + '.' : '') + (row.total_hit ? ' ' + tkn(row.total_hit) + ' ' + x.ou_pick + '.' : '') + NOTE;
      row.factors = ['Score: we projected ' + x.proj_score + ', it finished ' + hg + '-' + ag + '.'];
      hist.push(row);
    });
    return { hist, fin };
  }
  // Called by the page's rows() for the `history` and `final` datasets.
  function merge(id, base) {
    const raw = dash.data('history'), off = raw.status === 'ok' && Array.isArray(raw.data) ? raw.data : [];
    const P = provisional(off); if (!P.hist.length) return base;
    const key = (h) => (h.sport || 'nba') + '|' + h.id + '|' + nday(h.date), keys = new Set(P.hist.map(key));
    if (id === 'history') return base.filter((h) => !keys.has(key(h))).concat(P.hist);
    if (id === 'final') { const ids = new Set(P.fin.map((f) => f.id + '|' + f.date)); return base.filter((f) => !(f.status !== 'Final' && ids.has(f.id + '|' + nday(f.date)))).concat(P.fin); }
    return base;
  }

  // ---- Slip ticks: the plays from the owner's logged bets that sit on a finished game, green tick if they landed,
  // red cross if not (bets are private to the owner's Mac, so the public site never has any).
  function legState(l, h) {
    if (l.status === 'won') return 'hit'; if (l.status === 'lost') return 'miss'; if (l.status === 'void') return '';
    if (!h || h.status !== 'Final' || h.home_pts == null) return '';
    const hp = Number(h.home_pts), ap = Number(h.away_pts), tot = hp + ap, pick = String(l.pick || ''); let m;
    if ((m = pick.match(/^(Over|Under) ([\d.]+)/i)) && (l.market === 'Total' || l.market === 'Goals')) { const L = Number(m[2]); return tot === L ? '' : (/over/i.test(m[1]) ? tot > L : tot < L) ? 'hit' : 'miss'; }
    if (l.market === 'Winner') { if (/^draw$/i.test(pick)) return hp === ap ? 'hit' : 'miss'; const team = pick.replace(/ win$/i, ''); const home = nsim(team, h.home_name) || team === h.home; const away = nsim(team, h.away_name) || team === h.away; if (!home && !away) return ''; return hp === ap ? 'miss' : (home ? hp > ap : ap > hp) ? 'hit' : 'miss'; }
    if (l.market === 'Spread' && (m = pick.match(/^(.*) ([+-][\d.]+)$/))) { const home = nsim(m[1], h.home_name); const mg = (home ? hp - ap : ap - hp) + Number(m[2]); return mg === 0 ? '' : mg > 0 ? 'hit' : 'miss'; }
    return '';
  }
  function slipChips(h) {
    const out = [];
    betRows().forEach((b) => {
      const legs = legsOf(b) || [b];
      legs.forEach((l) => {
        if (!(l.sp === (h.sport || 'nba') && l.game === h.id && nday(l.date) === nday(h.date))) return;
        const st = legState(l, h); const c = el('span', 'Slip: ' + l.pick, 'chip slipchip ' + (st || 'open'));
        c.append(el('span', st === 'hit' ? '✓' : st === 'miss' ? '✕' : '–', 'mk ' + (st || 'na')));
        c.title = (legs.length > 1 ? legs.length + ' leg multi' : 'Single') + ' · $' + Number(b.stake || 0).toFixed(2) + ' @ ' + Number(b.price || 0).toFixed(2) + (st ? (st === 'hit' ? ' · landed' : ' · lost') : ' · waiting for the result');
        out.push(c);
      });
    });
    return out;
  }

  window.SSG = { defCourt, liveHome, betPill, candidates, mainCard, pickMain, liveCard, liveDecor, merge, slipChips, provisional };
})();
