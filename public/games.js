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
  const SIG = { nba: { m: 14, t: 19 }, nfl: { m: 13.5, t: 13 } }; // NBA widened 10 Nov (season misses: margin SD 14.6, total 18.6)

  // Every bet we can rate for one NBA or NFL game: [{market, pick, chance, price, book, est}]
  function candidates(sp, id, day) {
    const odds = rows('odds').filter((o) => o.sp === sp && o.game === id);
    const out = [];
    let H, A, mh, proj, winP, posted, total, mlH, mlA;
    if (sp === 'nba') {
      const gs = rows('games').filter((x) => x.id === id), p = rows('pred').find((x) => x.id === id), g = gs.find((x) => x.date === day) || gs[gs.length - 1]; if (!p || !g) return []; // same teams can meet on back-to-back days
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
  const priceTxt = (c) => (PUB ? '' : !c.price ? 'no price yet' : (c.est ? '≈ $' : '$') + c.price.toFixed(2) + (c.book && !c.est ? ' · ' + c.book : c.est ? ' (estimated)' : ''));

  // Main play card for an NBA or NFL game page.
  // ---- NBA back-to-backs: which team plays the night before or after this game (from past results, the current
  // slate and the 30-day schedule), and which of the two games matters more (division > conference > other conference).
  const NBA_DIV = { ATL: 'SE', CHA: 'SE', MIA: 'SE', ORL: 'SE', WAS: 'SE', BOS: 'AT', BKN: 'AT', NYK: 'AT', PHI: 'AT', TOR: 'AT', CHI: 'CE', CLE: 'CE', DET: 'CE', IND: 'CE', MIL: 'CE',
    DEN: 'NW', MIN: 'NW', OKC: 'NW', POR: 'NW', UTA: 'NW', GSW: 'PA', LAC: 'PA', LAL: 'PA', PHX: 'PA', SAC: 'PA', DAL: 'SW', HOU: 'SW', MEM: 'SW', NOP: 'SW', SAS: 'SW' };
  const confOf = (t) => (['SE', 'AT', 'CE'].includes(NBA_DIV[t]) ? 'East' : NBA_DIV[t] ? 'West' : '');
  const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const dayNum = (key) => { const m = String(key || '').match(/(\d+) (\w{3})/); if (!m || MON[m[2]] == null) return null; const now = new Date(), sy = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1, mo = MON[m[2]]; return Math.round(Date.UTC(mo >= 6 ? sy : sy + 1, mo, Number(m[1])) / 864e5); };
  const nbaAll = () => {
    const out = new Map(), names = {};
    const add = (id, away, home, day, an, hn) => { if (!id || !day) return; if (an) names[away] = an; if (hn) names[home] = hn; const n = dayNum(day); if (n == null) return; out.set(id + '|' + n, { id, away, home, n, day }); };
    rows('history').filter((h) => (h.sport || 'nba') === 'nba').forEach((h) => add(h.id, h.away, h.home, normDayX(h.date), h.away_name, h.home_name));
    rows('schedule').filter((h) => (h.sport || 'nba') === 'nba').forEach((h) => add(h.id, h.away, h.home, normDayX(h.date), h.away_name, h.home_name));
    rows('games').forEach((g) => { const [an, hn] = String(g.matchup || '').split(' @ '); add(g.id, g.away, g.home, normDayX(g.date), an, hn); });
    return { list: [...out.values()], names };
  };
  const normDayX = (d) => String(d || '').replace(/^(\w+) 0(\d) /, '$1 $2 ').trim();
  const imp = (t, o) => (NBA_DIV[t] && NBA_DIV[t] === NBA_DIV[o] ? 3 : confOf(t) && confOf(t) === confOf(o) ? 2 : 1);
  const IMPT = { 3: 'a division rival', 2: 'a conference game', 1: 'an other-conference game' };
  function b2bInfo(id, day) {
    const { list, names } = nbaAll(), n = dayNum(day); if (n == null) return null;
    const g = list.find((x) => x.id === id && x.n === n); if (!g) return null;
    const on = (t, k) => list.find((x) => x.n === k && (x.away === t || x.home === t));
    const vs = (t, x) => (x.away === t ? 'at ' : 'vs ') + (names[x.away === t ? x.home : x.away] || (x.away === t ? x.home : x.away));
    return [g.away, g.home].map((t) => {
      const opp = t === g.away ? g.home : g.away, prev = on(t, n - 1), next = on(t, n + 1);
      const last = list.filter((x) => x.n < n && (x.away === t || x.home === t)).sort((a, b) => b.n - a.n)[0];
      return { t, name: names[t] || t, opp, tonight: imp(t, opp), prev: prev && { vs: vs(t, prev), imp: imp(t, prev.away === t ? prev.home : prev.away) }, next: next && { vs: vs(t, next), imp: imp(t, next.away === t ? next.home : next.away) }, rest: last ? n - last.n - 1 : null };
    });
  }
  function b2bCard(id, day) {
    const info = b2bInfo(id, day); if (!info || !info.some((x) => x.prev || x.next)) return null;
    const card = el('div', null, 'card b2bcard'); card.append(el('h2', 'Back-to-backs'));
    info.forEach((x) => {
      const p = el('p'); p.append(el('b', x.name + ': '));
      const bits = [];
      if (x.prev) {
        bits.push('2nd night of a back-to-back (played ' + x.prev.vs + ' last night, ' + IMPT[x.prev.imp] + ').');
        bits.push(x.tonight > x.prev.imp ? 'Tonight is the bigger game for them: ' + IMPT[x.tonight] + '.' : x.tonight < x.prev.imp ? 'Tonight matters less to them (' + IMPT[x.tonight] + '), on tired legs.' : 'Tonight is also ' + (x.tonight === 3 ? 'against a division rival' : IMPT[x.tonight]) + '.');
      }
      if (x.next) {
        bits.push((x.prev ? 'They also play tomorrow: ' : '1st night of a back-to-back: tomorrow ') + x.next.vs + ' (' + IMPT[x.next.imp] + ').');
        bits.push(x.next.imp > x.tonight ? 'Tomorrow matters more to them, so watch for rest or lighter minutes tonight.' : x.next.imp < x.tonight ? 'Tonight is the bigger game for them (' + IMPT[x.tonight] + ').' : (x.tonight === 3 ? 'Both games are against division rivals.' : 'Both games are ' + IMPT[x.tonight].replace(/^an? /, '') + 's.'));
      }
      if (!bits.length) bits.push('Not on a back-to-back' + (x.rest != null ? ' (' + x.rest + (x.rest === 1 ? ' day' : ' days') + ' of rest).' : '.'));
      p.append(document.createTextNode(bits.join(' '))); card.append(p);
    });
    return card;
  }

  function mainCard(sp, id, day) {
    const list = candidates(sp, id, day); const m = pickMain(list); if (!m) return null;
    const card = el('div', null, 'card gpcard');
    const hd = el('div', null, 'gphd'); hd.append(el('h2', 'Main play'));
    if (sp === 'nba' && day) { const tags = (b2bInfo(id, day) || []).filter((x) => x.prev).map((x) => el('span', 'B2B · 2nd night: ' + x.t, 'b2btag')); if (tags.length) { const tg = el('div', null, 'b2btags'); tg.append(...tags); hd.append(tg); } }
    card.append(hd);
    const top = el('div', null, 'gptop'); top.append(el('b', m.pick, 'gpk'), el('span', m.chance + '% chance · ' + conf(m.chance), 'gpp'), el('span', priceTxt(m), 'gppr' + (m.price < MIN_PRICE ? ' low' : '')));
    card.append(top);
    const safest = list.slice().sort((a, b) => b.chance - a.chance)[0];
    if (safest && safest !== m) card.append(el('p', 'Safest bet: ' + safest.pick + ' (' + safest.chance + '%, ' + priceTxt(safest) + ').', 'gpsafe'));
    const tiles = el('div', null, 'gpall');
    ['Winner', 'Spread', 'Total'].forEach((mk) => { const best = list.filter((c) => c.market === mk).sort((a, b) => b.chance - a.chance)[0]; if (!best) return; const d = el('div'); d.append(el('span', mk), el('b', best.pick), el('small', best.chance + '%' + (PUB ? '' : ' · ' + (best.price ? (best.est ? '≈$' : '$') + best.price.toFixed(2) : '–')))); tiles.append(d); });
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
      const plays = today.map((i) => { const m = i.sp === 'fb' ? fbMain(i.x) : pickMain(candidates(i.sp, i.id, i.day)); return m ? { ...i, m } : null; }).filter((i) => i && i.m.price >= MIN_PRICE);
      // Our own milestone props (propPlays, prop finder) are hidden from Best bets (owner, 10 Nov): only bookie
      // props with real AU prices show. To bring them back: const props = propPlays(today.filter((i) => i.sp === 'nba'));
      const props = [];
      const bprops = bookPlays(key, aheadIds), alts = altPlays(key);
      if (plays.length || props.length || bprops.length || alts.length) { groups.push({ key, plays: plays.sort((a, b) => b.m.chance - a.m.chance), props, bprops, alts }); break; }
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
  // Public site (not this Mac): no market prices are shown, and the picks come from the cleaned public copies
  // (pubprops / pubalts / pubbets from export-public.js) because the private files never leave the Mac.
  // Prices, books and edges show on the public site too since the paid Odds API plan (13 Nov 2026).
  const PUB = false;
  const propSrc = () => (rows('propbook').length ? rows('propbook') : rows('pubprops').map((r) => ({ ...r, price: 0, pub: true })));
  const altSrc = () => (rows('altlines').length ? rows('altlines') : rows('pubalts').map((r) => ({ ...r, price: 0, pub: true })));
  // Alternate lines and totals (altlines, Mac only: fetch-alt-lines.js): our chance from the margin / total model
  // at 75%+ paying $1.30+; one per game, market and side (our highest chance).
  function altPlays(key) {
    const now = Date.now(), seen = new Set(), out = [];
    altSrc().filter((r) => r.day === key && num(r.our) >= BOOK_MIN && (r.pub || num(r.price) >= BOOK_PRICE) && new Date(r.kick).getTime() > now)
      .sort((a, b) => num(b.our) - num(a.our)).forEach((r) => {
        const k = r.sp + '|' + r.game + '|' + r.market + '|' + r.pick.replace(/ [-+]?[\d.]+$/, ''); if (seen.has(k)) return; seen.add(k);
        const time = new Date(r.kick).toLocaleTimeString('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', minute: '2-digit' }).toUpperCase();
        out.push({ sp: r.sp, id: r.game, day: r.day, match: r.match, time, m: { market: 'Alt ' + r.market.toLowerCase(), pick: r.pick, chance: Math.round(num(r.our)), rank: num(r.our), price: num(r.price), book: r.book, est: false, hit: '' } });
      });
    return out;
  }
  // NBA and NFL (sp on each row); only games still to start; one line per player and stat (our highest chance).
  function bookPlays(key, aheadIds) {
    const now = Date.now(), seen = new Set(), out = [];
    propSrc().filter((r) => r.day === key && num(r.chance) >= BOOK_MIN && (r.pub || num(r.price) >= BOOK_PRICE) && (r.kick ? new Date(r.kick).getTime() > now : aheadIds.has((r.sp || 'nba') + '|' + r.game + '|' + r.day)))
      .sort((a, b) => num(b.chance) - num(a.chance)).forEach((r) => {
        const k = (r.sp || 'nba') + '|' + r.player + '|' + r.stat; if (seen.has(k)) return; seen.add(k);
        const g = rows('games').find((x) => x.id === r.game && x.date === r.day);
        const time = r.kick ? new Date(r.kick).toLocaleTimeString('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', minute: '2-digit' }).toUpperCase() : '';
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
  // Price since we first saw it (valuelog, local only) and injury news on a player prop's player (troster).
  const vlMap = () => { const g = dash.data('valuelog'), gen = g.data; if (vlMap.gen !== gen) { vlMap.gen = gen; vlMap.m = new Map((Array.isArray(gen) ? gen : []).map((x) => [x.sp + '|' + x.game + '|' + x.day + '|' + x.pick, x])); } return vlMap.m; };
  const injOf = (sp, f) => { if (!f) return ''; const t = rows('troster').filter((x) => x.sp === sp); for (const tm of t) for (const i of tm.inj || []) if (String(i[0]) === String(f.pid) || (i[1] && i[1] === f.player)) return i[3] || ''; return ''; };
  const bbIcon = (i) => { const f = i.m.finder, ic = el('span', null, 'bbic');
    if (f && f.side && f.pid && X.avatar) { ic.classList.add('face'); ic.append(X.avatar(i.sp === 'nba' ? 'nba' : (X.AT_HS && X.AT_HS[i.sp]) || i.sp, f.pid, f.player)); } // player's headshot
    else if ((i.sp === 'nba' || i.sp === 'nfl') && /^[A-Z]+-[A-Z]+$/.test(i.id) && X.badge) {
      // the team we're backing (winner / line); a total backs no team, so it shows both
      const [a, h] = i.id.split('-'), bd = i.sp === 'nba' ? X.badge : X.bdX, [an, hn] = String(i.match || '').split(' @ '), pk = String(i.m.pick || '');
      const pick = an && pk.startsWith(an + ' ') ? a : hn && pk.startsWith(hn + ' ') ? h : null;
      if (pick) { ic.classList.add('one'); ic.append(bd(pick)); } else { ic.classList.add('two'); ic.append(bd(a), bd(h)); }
    }
    else { const src = window.TAB_ICONS && window.TAB_ICONS[i.sp]; if (src) { const im = document.createElement('img'); im.src = src; im.alt = ''; ic.append(im); } }
    return ic;
  };
  const bbRow = (i) => {
    const b = el('button', null, 'bbr'); b.type = 'button';
    const f = i.m.finder, ic = bbIcon(i);
    const sub = f ? `Hit ${f.hit} this season · avg ${f.avg}, last ${f.sp === 'nfl' ? 3 : 5} ${f.l5}${f.why && f.why.length ? ' · ' + f.why[0] : ''} · ${i.match}` : (i.m.hit ? 'Hit ' + i.m.hit + ' this season · ' : '') + i.match + (i.time ? ' · ' + i.time : '');
    const l = el('div', null, 'l'); l.append(el('b', i.m.pick), el('span', sub));
    const r = el('div', null, 'r'); r.append(el('b', i.m.chance + '%', 'c ' + conf(i.m.chance)), el('span', PUB || !i.m.price ? '' : (i.m.est ? '≈$' : '$') + i.m.price.toFixed(2) + (i.m.book && !i.m.est ? ' ' + i.m.book.replace(' (AU)', '') : '')));
    const v = !i.m.est && vlMap().get(i.sp + '|' + i.id + '|' + i.day + '|' + i.m.pick);
    if (v && Math.abs(num(v.price0) - i.m.price) >= 0.02) { const up = i.m.price > num(v.price0); r.append(el('small', (up ? '▲' : '▼') + ' from $' + num(v.price0).toFixed(2), 'bbmv ' + (up ? 'up' : 'dn'))); }
    const nw = f && f.side ? newsOf(f.pid) : [];
    if (nw.length) { const tg = el('em', 'In the news · ' + ago(nw[0].published), 'bbnews'); tg.title = nw[0].headline; l.append(tg); }
    const inj = f && f.side ? injOf(i.sp, f) : '';
    if (inj) { l.append(el('em', /out/i.test(inj) ? 'Now listed OUT: skip this one' : 'Injury news: ' + inj + ' (check before betting)', 'bbinj')); b.classList.add(/out/i.test(inj) ? 'bbout' : 'bbq'); }
    b.append(ic, l, r); b.addEventListener('click', () => (f && f.side && window.SSPP ? window.SSPP.focus(i.sp, f.stat, f.line, f.player, f.pid) : X.openGame(i.sp, i.id, i.day)));
    return b;
  };
  // ---- Best bets for one game (its own tab on the game page): the game markets we rate, alt lines and player props
  // with the same rules as the Bets page (our chance 75%+ paying $1.30+ for alt lines and props).
  function gameBets(sp, id, day) {
    const card = el('div', null, 'card gbcard'); card.append(el('h2', 'Best bets'));
    if (!bbReady()) { card.append(skel(3)); return card; }
    const ahead = new Set([sp + '|' + id + '|' + day]);
    const hs = rows('history').find((h) => (h.sport || 'nba') === sp && h.id === id && nday(h.date) === nday(day)), lv = liveOf(sp, id, day);
    if ((hs && (hs.status === 'Final' || hs.status === 'Live')) || (lv && lv.state !== 'pre')) card.append(el('p', 'This game has started, so betting has closed. These were the best bets before kick-off.', 'gbclosed'));
    const gr = sp === 'nba' ? rows('games').find((x) => x.id === id && x.date === day) : rows('nflgames').find((x) => x.id === id);
    const match = gr ? (sp === 'nba' ? gr.matchup : gr.away_name + ' @ ' + gr.home_name) : '';
    // game markets: only the side we favour (50%+) with a real price
    const plays = candidates(sp, id, day).filter((c) => c.price >= MIN_PRICE && c.chance >= 50).sort((a, b) => b.chance - a.chance).map((m) => ({ sp, id, day, match, time: '', m }));
    const alts = altPlays(day).filter((i) => i.sp === sp && i.id === id);
    const props = bookPlays(day, ahead).filter((i) => i.sp === sp && i.id === id);
    if (!plays.length && !alts.length && !props.length) { card.append(el('p', 'No priced bets for this game yet. Prices are fetched at 8:15 am and 8:15 pm Sydney time.', 'muted')); return card; }
    const sec = (title, list, n) => {
      if (!list.length) return;
      card.append(el('div', title + ' · ' + list.length, 'bbday bbsub'));
      const box = el('div', null, 'gbrows'); list.slice(0, n).forEach((i) => box.append(bbRow(i))); card.append(box);
      if (list.length > n) { const more = el('button', 'Show all ' + list.length + ' ›', 'bbmore'); more.type = 'button'; more.addEventListener('click', (e) => { e.stopPropagation(); box.replaceChildren(...list.map(bbRow)); more.remove(); }); card.append(more); }
    };
    sec('Game markets', plays, 6);
    sec('Alt lines · our chance 75%+ at $1.30+', alts, 6);
    sec('Player props · our chance 75%+ at $1.30+', props, 10);
    return card;
  }

  // ---- UFC: how the fight ends. Our own chance of each fighter winning by KO/TKO, submission or decision, with a
  // fair price (100 / chance) to compare against the bookies (method markets aren't in The Odds API).
  //   chance(A by method) = chance A wins (our pick %) x share of A's wins by that method, where the share blends
  //   A's own wins, B's losses (how B tends to lose) and the UFC base rates for the division (men / women).
  const UFC_BASE = { men: { ko: 0.33, sub: 0.19, dec: 0.48 }, women: { ko: 0.18, sub: 0.20, dec: 0.62 } };
  const UFC_PRIOR = 4; // base-rate weight, in fights: keeps short records sensible
  const ufcName = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\(c\)/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  const ufcFightsOf = (name) => { const n = ufcName(name), r = rows('ufcp').find((x) => ufcName(x.name) === n); if (!r) return null; let f = r.f; if (typeof f === 'string') { try { f = JSON.parse(f); } catch (e) { f = []; } } return Array.isArray(f) ? f : []; };
  const mKey = (m) => (/KO|TKO/.test(m) ? 'ko' : /SUB|SUMISSION/.test(m) ? 'sub' : /DEC/.test(m) ? 'dec' : null);
  function ufcMethods(r) {
    if (!r || !r.a || !r.b || !r.pick_pct) return null;
    const fa = ufcFightsOf(r.a), fb = ufcFightsOf(r.b); if (!fa || !fb) return null;
    const base = UFC_BASE[/women/i.test(r.weight || '') ? 'women' : 'men'];
    const count = (fs, res) => { const c = { ko: 0, sub: 0, dec: 0 }; fs.forEach((x) => { const k = x[5] === res && mKey(String(x[6] || '')); if (k) c[k]++; }); return c; };
    const share = (wins, losses) => { const t = {}; let s = 0; ['ko', 'sub', 'dec'].forEach((k) => { t[k] = wins[k] + losses[k] + UFC_PRIOR * base[k]; s += t[k]; }); ['ko', 'sub', 'dec'].forEach((k) => { t[k] /= s; }); return t; };
    const pA = (r.pick === r.a ? r.pick_pct : 100 - r.pick_pct) / 100;
    const sA = share(count(fa, 'W'), count(fb, 'L')), sB = share(count(fb, 'W'), count(fa, 'L'));
    const nm = (x) => String(x).replace(/\s*\(c\)/, '').split(' ').slice(-1)[0];
    const LAB = { ko: 'KO/TKO', sub: 'Submission', dec: 'Decision' };
    const list = [];
    ['ko', 'sub', 'dec'].forEach((k) => { list.push({ who: nm(r.a), side: 'a', k, p: pA * sA[k] }); list.push({ who: nm(r.b), side: 'b', k, p: (1 - pA) * sB[k] }); });
    const card = el('div', null, 'card ufcm'); card.append(el('h2', 'How it ends'));
    card.append(el('p', 'Our chance of each result, from both fighters\' records (how each wins, how the other loses) and our pick. The fair price is what the bet is worth to us: if your bookie pays more, it\'s value.', 'muted'));
    const t = el('table', null, 'dtbl ufcmt'); const hr = el('tr'); ['Result', 'Our chance', 'Fair price'].forEach((h, j) => hr.append(el('th', h, j ? 'n' : ''))); t.append(hr);
    list.sort((x, y) => y.p - x.p).forEach((x) => { const tr = el('tr', null, 'side-' + x.side); tr.append(el('td', x.who + ' by ' + LAB[x.k]), el('td', Math.round(x.p * 100) + '%', 'n'), el('td', x.p > 0.005 ? '$' + (1 / x.p).toFixed(2) : '–', 'n')); t.append(tr); });
    const w = el('div', null, 'scroll'); w.append(t); card.append(w);
    const fin = list.filter((x) => x.k !== 'dec').reduce((s2, x) => s2 + x.p, 0);
    card.append(el('p', 'Goes the distance (any decision): ' + Math.round((1 - fin) * 100) + '% · fair $' + (1 / Math.max(0.01, 1 - fin)).toFixed(2) + '. Ends inside the distance: ' + Math.round(fin * 100) + '% · fair $' + (1 / Math.max(0.01, fin)).toFixed(2) + '.', 'muted'));
    return card;
  }

  // UFC fight page: the breakdown split into tabs (Tape / Striking & grappling / Odds / Fight record); the tab picked is
  // kept per fight while the page redraws, and a fight opened fresh starts on Tape.
  const UFT = window.UFT = {};
  function ufcTabs(r, G, recBox) {
    const T = [['tape', 'Tape', 'Side by side: the stronger number in each row is highlighted.'], ['fight', 'Stats', 'Career UFC rates. The stronger number in each row is highlighted.'], ['odds', 'Odds', ''], ['rec', 'Record', '']];
    const panes = {}, wrap = el('div', null, 'uftabs');
    T.forEach(([k, , note]) => {
      const p = el('div', null, 'ufpane'); if (note) p.append(el('p', note, 'muted'));
      if (k === 'odds') { const hm = ufcMethods(r); if (hm) p.append(hm); }
      if (G[k]) { const w = el('div', null, 'scr'); w.style.overflowX = 'auto'; w.append(G[k]); p.append(w); }
      if (k === 'rec' && recBox) p.append(recBox);
      if (p.childNodes.length) panes[k] = p;
    });
    const bar = el('div', null, 'nfltabs uftabbar');
    const show = (k) => { UFT[r.id] = k; Object.entries(panes).forEach(([q, p]) => { p.hidden = q !== k; }); bar.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.k === k)); };
    T.forEach(([k, l]) => { if (!panes[k]) return; const b = el('button', l); b.type = 'button'; b.dataset.k = k; b.addEventListener('click', (e) => { e.stopPropagation(); show(k); const top = wrap.getBoundingClientRect().top + scrollY - 70; if (scrollY > top) window.scrollTo(0, top); }); bar.append(b); });
    wrap.append(bar, ...Object.values(panes)); show(UFT[r.id] && panes[UFT[r.id]] ? UFT[r.id] : 'tape');
    return wrap;
  }

  // Grey placeholder rows while data loads (instead of "Loading…").
  const skel = (n = 4) => { const w = el('div', null, 'skel'); w.setAttribute('aria-label', 'Loading'); for (let k = 0; k < n; k++) w.append(el('i')); return w; };
  const bbReady = () => ['games', 'pred', 'fixtures', 'odds', 'propfind', 'propbook', 'altlines'].every((d) => dash.data(d).status !== 'loading');
  dash.draw('bestbets', (box) => {
    if (!bbReady()) { box.replaceChildren(skel()); return; }
    const groups = bestBets(), g = groups[0];
    if (!g) { box.replaceChildren(el('p', 'No priced plays for today or tomorrow yet.', 'plnone')); return; }
    const out = [el('div', g.key, 'bbday')];
    if (g.plays.length) out.push(el('div', 'Game props', 'bbday bbsub'), ...g.plays.slice(0, 3).map(bbRow));
    if (g.alts && g.alts.length) out.push(el('div', 'Alt lines · our chance 75%+ at $1.30+', 'bbday bbsub'), ...g.alts.slice(0, 3).map(bbRow));
    if (g.bprops && g.bprops.length) out.push(el('div', 'Player props · our chance 75%+ at $1.30+', 'bbday bbsub'), ...g.bprops.slice(0, 3).map(bbRow));
    if (g.props.length) out.push(el('div', 'Player props · our chance 75%+', 'bbday bbsub'), ...g.props.slice(0, 3).map(bbRow));
    const n = groups.reduce((t, x) => t + x.plays.length + x.props.length + (x.bprops ? x.bprops.length : 0) + (x.alts ? x.alts.length : 0), 0);
    const more = el('button', 'See all ' + n + ' best bets ›', 'bbmore'); more.type = 'button';
    more.addEventListener('click', () => X.openBets()); out.push(more);
    box.replaceChildren(...out);
  });
  const BBF = (() => { try { return { sp: 'all', kind: 'all', hi: false, ...JSON.parse(localStorage.getItem('ss_bbf') || '{}') }; } catch (e) { return { sp: 'all', kind: 'all', hi: false }; } })();
  // Best bets page: every play at $1.40 or more, by day, best chance first.
  dash.draw('bestall', (box) => {
    if (!bbReady()) { box.replaceChildren(skel()); return; }
    const groups0 = bestBets();
    if (!groups0.length) { box.replaceChildren(el('p', 'No priced plays for today or tomorrow yet.', 'plnone')); return; }
    // Filter chips: sport, kind of bet, 80%+ only (remembered in this browser).
    const sps = [...new Set(groups0.flatMap((g) => [...g.plays, ...(g.alts || []), ...(g.bprops || [])].map((i) => i.sp)))];
    if (BBF.sp !== 'all' && !sps.includes(BBF.sp)) BBF.sp = 'all';
    const keep = (i) => (BBF.sp === 'all' || i.sp === BBF.sp) && (!BBF.hi || i.m.chance >= 80);
    const groups = groups0.map((g) => ({ ...g, plays: BBF.kind === 'player' ? [] : g.plays.filter(keep), alts: BBF.kind === 'player' ? [] : (g.alts || []).filter(keep), bprops: BBF.kind === 'game' ? [] : (g.bprops || []).filter(keep) }));
    const chips = el('div', null, 'bbchips');
    const chip = (lab, on, fn) => { const c = el('button', lab, 'bbchip' + (on ? ' on' : '')); c.type = 'button'; c.addEventListener('click', () => { fn(); try { localStorage.setItem('ss_bbf', JSON.stringify(BBF)); } catch (e) { /* not kept */ } dash.draw('bestall'); }); return c; };
    const SPN = { nba: 'NBA', nfl: 'NFL', fb: 'Football' };
    if (sps.length > 1) { chips.append(chip('All sports', BBF.sp === 'all', () => { BBF.sp = 'all'; })); sps.forEach((x) => chips.append(chip(SPN[x] || x.toUpperCase(), BBF.sp === x, () => { BBF.sp = x; }))); chips.append(el('i', null, 'bbsep')); }
    [['all', 'All bets'], ['game', 'Game props'], ['player', 'Player props']].forEach(([k, lab]) => chips.append(chip(lab, BBF.kind === k, () => { BBF.kind = k; })));
    chips.append(el('i', null, 'bbsep'), chip('80%+ only', BBF.hi, () => { BBF.hi = !BBF.hi; }));
    const out = [chips];
    if (!groups.some((g) => g.plays.length || g.alts.length || g.bprops.length)) out.push(el('p', 'Nothing matches these filters.', 'plnone'));
    groups.forEach((g) => {
      out.push(el('div', g.key, 'bbday'));
      if (g.plays.length) { out.push(el('div', 'Game props · ' + g.plays.length, 'bbday bbsub'), el('p', 'Winner, line and total for each game: our best play at $1.40 or more.', 'muted bbnote')); out.push(...g.plays.map(bbRow)); }
      if (g.alts && g.alts.length) { out.push(el('div', 'Alt lines · ' + g.alts.length, 'bbday bbsub'), el('p', 'Alternate lines and totals from AU bookies (e.g. a bigger start than the main line) where our margin / total model gives 75%+ and the price is $1.30+, one per game and side. Uses the spread of real results this season (margins miss our projection by about 14 points, totals by 19).', 'muted bbnote')); out.push(...g.alts.map(bbRow)); }
      if (g.bprops && g.bprops.length) {
        // Player props in their own drop-down, best season hit rate first (then our chance).
        const hr = (i) => { const m = String(i.m.hit || '').match(/(\d+)\/(\d+)/); return m && +m[2] ? +m[1] / +m[2] : 0; };
        // Game picker: all games, or one game's best props (tap a game).
        const gms = [...new Map(g.bprops.map((i) => [i.sp + '|' + i.id, i])).values()].sort((a, b) => String(a.time).localeCompare(String(b.time)));
        if (BBF.game && !gms.some((i) => i.sp + '|' + i.id === BBF.game)) BBF.game = '';
        const list = g.bprops.filter((i) => !BBF.game || i.sp + '|' + i.id === BBF.game).sort((a, b) => hr(b) - hr(a) || b.m.rank - a.m.rank);
        const gchips = el('div', null, 'bbchips bbgames');
        if (gms.length > 1) { gchips.append(chip('All games', !BBF.game, () => { BBF.game = ''; BBF.pOpen = true; }));
          gms.forEach((i) => { const k = i.sp + '|' + i.id, n = g.bprops.filter((x) => x.sp + '|' + x.id === k).length; gchips.append(chip(i.id.replace('-', ' @ ') + ' · ' + n, BBF.game === k, () => { BBF.game = BBF.game === k ? '' : k; BBF.pOpen = true; })); }); }
        const d = el('details', null, 'bbdrop'); if (BBF.kind === 'player' || BBF.pOpen) d.open = true; d.addEventListener('toggle', () => { BBF.pOpen = d.open; }); const sm = el('summary'); sm.append(el('b', 'Player props · best hit rate'), el('span', String(list.length), 'muted'));
        d.append(sm, ...(gms.length > 1 ? [gchips] : []), el('p', 'Real Australian bookie lines (NBA and NFL) where our chance is 75%+ and the price is $1.30+, one per player and stat, sorted by how often he has cleared it this season. Our chance comes from his game logs; tested on this season, lines we rate 75%+ hit about 80% (NBA) and 77-91% (NFL). A big gap to the bookie can mean they know something (minutes, late injury news). Tap one to open the player.', 'muted bbnote'), ...list.map(bbRow));
        out.push(d);
      }
      if (g.props.length) { const top = g.props.slice(0, 30); out.push(el('div', 'Player props · ' + g.key + ' · top ' + top.length + ' of ' + g.props.length, 'bbday bbsub'), el('p', 'Our chance from each player\'s game logs: season average plus recent form, out players removed. Tested on every game day this season using only earlier games: plays at 75%+ hit 81%. ≈ is our fair price (no bookmaker line saved); take it only if the bookie pays more. Reasons like home/away or the opponent are shown but did not improve the chance in testing, so they do not move it.', 'muted bbnote')); out.push(...top.map(bbRow)); }
    });
    box.replaceChildren(...out);
  });

  // ---- Track record (Review, local only): every bet we rated (valuelog, value-log.js), settled from results.
  // Did our 70% / 80% picks really win that often, and would $1 on each have made money?
  dash.draw('trackrec', (box) => {
    const sec = box.closest('section'); const g = dash.data('valuelog');
    const all = g.status === 'ok' && Array.isArray(g.data) ? g.data : [];
    const done = all.filter((x) => x.status === 'won' || x.status === 'lost');
    if (sec) sec.classList.toggle('isempty', !all.length); if (!all.length) { box.replaceChildren(); return; }
    const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
    const sum = (a) => { const w = a.filter((x) => x.status === 'won').length, pnl = a.reduce((t, x) => t + (x.status === 'won' ? num(x.price) - 1 : -1), 0), said = a.length ? a.reduce((t, x) => t + num(x.our), 0) / a.length : 0; return { n: a.length, w, pnl, said }; };
    const days = new Set(done.map((x) => x.day)).size, open = all.length - done.length - all.filter((x) => x.status === 'void').length;
    const out = [el('p', done.length ? `${done.length} bets settled over ${days} ${days === 1 ? 'day' : 'days'} (${open} still to play). Each is every line we rated, at the last Australian price before the game, as if $1 went on it.` : `${open} bets saved, none settled yet. Results come in after each game (player props the next day).`, 'muted bbnote')];
    if (!done.length) { box.replaceChildren(...out); return; }
    // one row per kind of bet, and the Best bets rule on its own line
    const T = el('div', null, 'trk');
    const row = (lab, a, sub) => { const x = sum(a); if (!x.n) return; const r = el('div', null, 'trr' + (sub ? ' sub' : '')); const wp = pct(x.w, x.n), d = wp - Math.round(x.said);
      r.append(el('b', lab), el('span', x.n + ' bets'), el('span', 'won ' + wp + '%', d >= -3 ? 'up' : d <= -8 ? 'dn' : ''), el('span', 'we said ' + Math.round(x.said) + '%', 'muted'), el('span', money(x.pnl), x.pnl > 0 ? 'up' : x.pnl < 0 ? 'dn' : '')); T.append(r); };
    const BB = (x) => x.our >= 75 && num(x.price) >= 1.3;
    [['game', 'Game picks'], ['alt', 'Alt lines'], ['prop', 'Player props']].forEach(([k, lab]) => { const a = done.filter((x) => x.src === k); row(lab, a); row('Best bets only (75%+, $1.30+)', a.filter(BB), true); });
    out.push(T);
    // calibration: what we said against what happened, by chance band (all kinds together)
    out.push(el('div', 'When we said… it won', 'mbsec'));
    const C = el('div', null, 'trcal');
    [[50, 60], [60, 70], [70, 80], [80, 90], [90, 101]].forEach(([lo, hi]) => {
      const a = done.filter((x) => x.our >= lo && x.our < hi); if (!a.length) return; const x = sum(a), wp = pct(x.w, x.n);
      const r = el('div', null, 'trcr'); const tr = el('div', null, 'trbar'); const f = el('i', null, wp >= Math.round(x.said) - 3 ? 'up' : 'dn'); f.style.width = wp + '%'; const m = el('em'); m.style.left = Math.round(x.said) + '%'; tr.append(f, m);
      r.append(el('span', lo + '–' + (hi > 100 ? 100 : hi) + '%'), tr, el('b', wp + '%'), el('small', x.n + '')); C.append(r);
    });
    out.push(C, el('p', 'Bar = how often it won; the tick = what we said. Bars past the tick mean we were too careful, short of it too confident. A few days of results swing a lot: judge it after a few weeks.', 'muted bbnote'));
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
    const st = betStats();
    if (!st.n) { // public site: only the cleaned copy is there, so the record and open bets, never money
      const pb = rows('pubbets'), rec = pb.find((r) => r.kind === 'record'); if (!rec) return null;
      const open = pb.filter((r) => r.kind === 'bet').length;
      const b = el('button', null, 'betpill ' + (rec.won > rec.lost ? 'up' : rec.won < rec.lost ? 'dn' : '')); b.type = 'button'; b.title = "Jacob's picks";
      b.append(el('span', "Jacob's picks", 'bpr'), el('b', rec.won + '-' + rec.lost, 'bpp'), el('span', open ? open + ' open' : 'all settled', 'bprun'));
      b.addEventListener('click', () => { const t = document.querySelector('#bnav [data-sec=bets]'); if (t) t.click(); }); return b;
    }
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
  // Day-by-day profit / loss: one bar per settle day, up (green) for a winning day, down (red) for a losing one,
  // from a zero line. Tap or hover a bar for that day's bets, record, result and the running total.
  const dayTime = (d) => { const m = String(d || '').match(/(\d+) (\w{3})/); if (!m) return 0; const now = new Date(); let t = Date.parse(m[1] + ' ' + m[2] + ' ' + now.getFullYear()); if (t > now.getTime() + 7 * 86400000) t = Date.parse(m[1] + ' ' + m[2] + ' ' + (now.getFullYear() - 1)); return t || 0; };
  function plDays(settled) {
    const by = {}; settled.forEach((b) => { const d = String(b.settled || b.placed || '').split(',')[0]; (by[d] = by[d] || []).push(b); });
    const days = Object.keys(by).filter((d) => dayTime(d)).sort((a, b) => dayTime(a) - dayTime(b)).slice(-14);
    if (days.length < 2) return null;
    let run = 0; const rows = days.map((d) => { const bs = by[d], v = bs.reduce((t, b) => t + profitOf(b), 0); run += v; const w = bs.filter((b) => b.status === 'won').length; return { d, v, run, n: bs.length, w }; });
    const max = Math.max(1, ...rows.map((r) => Math.abs(r.v)));
    const wrap = el('div', null, 'pld'), plot = el('div', null, 'pldplot'), read = el('p', null, 'pldread');
    plot.setAttribute('role', 'img'); plot.setAttribute('aria-label', 'Profit and loss by day: ' + rows.map((r) => r.d + ' ' + money(r.v)).join(', '));
    const show = (r, col) => { read.replaceChildren(el('b', r.d), document.createTextNode(' · ' + r.n + (r.n === 1 ? ' bet' : ' bets') + ' · ' + r.w + '-' + (r.n - r.w) + ' · '), el('b', money(r.v), r.v > 0 ? 'up' : r.v < 0 ? 'dn' : ''), document.createTextNode(' · running ' + money(r.run))); plot.querySelectorAll('.pldc').forEach((c) => c.classList.toggle('on', c === col)); };
    const hiI = rows.reduce((b, r, i) => (r.v > rows[b].v ? i : b), 0), loI = rows.reduce((b, r, i) => (r.v < rows[b].v ? i : b), 0);
    rows.forEach((r, i) => {
      const col = el('button', null, 'pldc'); col.type = 'button'; col.setAttribute('aria-label', r.d + ': ' + money(r.v));
      const up = el('div', null, 'pldu'), dn = el('div', null, 'pldd'), bar = el('i', null, r.v >= 0 ? 'up' : 'dn');
      bar.style.height = Math.max(r.v ? 3 : 0, (100 * Math.abs(r.v)) / max) + '%';
      (r.v >= 0 ? up : dn).append(bar);
      if ((i === hiI && r.v > 0) || (i === loI && r.v < 0)) bar.append(el('small', money(r.v).replace('.00', ''), 'pldl'));
      col.append(up, dn, el('span', r.d.split(' ')[0].slice(0, 2) + ' ' + r.d.split(' ')[1], 'pldx'));
      col.addEventListener('mouseenter', () => show(r, col)); col.addEventListener('focus', () => show(r, col)); col.addEventListener('click', () => show(r, col));
      plot.append(col);
    });
    wrap.append(plot, read); show(rows[rows.length - 1], plot.lastChild);
    return wrap;
  }
  // Public site: Jacob's picks from pubbets (export-public.js): the win-loss record and the open bets, no money.
  function pubBets(pb) {
    const rec = pb.find((x) => x.kind === 'record') || { won: 0, lost: 0 }, open = pb.filter((x) => x.kind === 'bet');
    const st = el('div', null, 'ppst'); const cell = (lab, v) => { const d = el('div'); d.append(el('span', lab), el('b', v)); return d; };
    st.append(cell('Record', rec.won + '-' + rec.lost), cell('Open bets', String(open.length || 'None')));
    const out = [st];
    if (open.length) {
      out.push(el('div', 'Open', 'mbsec')); const t = el('div', null, 'mbl');
      open.slice().reverse().forEach((b) => {
        const legs = Array.isArray(b.legs) ? b.legs : null, r = el('div', null, 'mbr open' + (legs ? ' multi' : '')), top = el('div', null, 'mbt'), l = el('div');
        l.append(el('b', legs ? legs.length + ' leg ' + (b.sgm ? 'same game multi' : 'multi') : b.pick), el('span', [legs ? null : b.match, b.placed].filter(Boolean).join(' · ')));
        top.append(l); r.append(top);
        if (legs) { const ul = el('div', null, 'mblegs'); legs.forEach((x) => { const d = el('div', null, 'mbleg ' + (x.status || 'open')); const tx = el('div'); tx.append(el('b', x.pick), el('span', x.final || x.match)); d.append(legIcon(x.status), tx); ul.append(d); });
          r.append(el('span', legs.filter((x) => x.status === 'won').length + ' of ' + legs.length + ' legs landed', 'mbcount'), ul); }
        t.append(r);
      });
      out.push(t);
    }
    return out;
  }
  // Home: all my bets in one place: record, open bets, then the latest results (full list in Review).
  dash.draw('mybets', (box) => {
    { const st = dash.data('bets').status, sec = box.closest('section'), pb = rows('pubbets');
      if (st !== 'ok' && st !== 'loading' && pb.length) { if (sec) sec.classList.remove('isempty'); box.replaceChildren(...pubBets(pb)); return; }
      if (sec) sec.classList.toggle('isempty', st !== 'ok' && st !== 'loading'); if (st !== 'ok') { if (st === 'loading') box.replaceChildren(skel(2)); return; } }
    const all = betRows(), open = all.filter(isOpen).reverse(), done = all.filter((b) => !isOpen(b)).reverse();
    if (!all.length) { box.replaceChildren(el('p', 'No bets yet. Send Claude a screenshot of a bet and it shows here.', 'plnone')); return; }
    const settled = done.filter((b) => b.status === 'won' || b.status === 'lost'), won = settled.filter((b) => b.status === 'won').length, profit = settled.reduce((s, b) => s + profitOf(b), 0);
    const pot = open.reduce((s, b) => s + (isBonus(b) ? num(b.stake) * (num(b.price) - 1) : num(b.stake) * num(b.price)), 0);
    const st = el('div', null, 'ppst');
    const cell = (lab, v, c) => { const d = el('div', null, c || ''); d.append(el('span', lab), el('b', v)); return d; };
    st.append(cell('Record', won + '-' + (settled.length - won)), cell('Profit', money(profit), profit > 0 ? 'up' : profit < 0 ? 'dn' : ''), cell(open.length ? open.length + ' open · could pay' : 'Open bets', open.length ? '$' + pot.toFixed(2) : 'None'));
    const out = [st];
    { const ch = plDays(settled); if (ch) out.push(el('div', 'Day by day', 'mbsec'), ch); }
    if (open.length) { out.push(el('div', 'Open', 'mbsec')); const t = el('div', null, 'mbl'); open.forEach((b) => t.append(betCard(b))); out.push(t); }
    if (done.length) {
      // Latest results in a drop-down bar (closed by default)
      const d = el('details', null, 'bbdrop mbres'), sm = el('summary'); sm.append(el('b', 'Latest results'), el('span', String(Math.min(3, done.length)) + ' of ' + done.length, 'muted'));
      const t = el('div', null, 'mbl'); done.slice(0, 3).forEach((b) => t.append(betCard(b)));
      const more = el('button', 'All ' + done.length + ' results and the profit chart ›', 'bbmore'); more.type = 'button'; more.addEventListener('click', () => X.openBetResults());
      d.append(sm, t, more); out.push(d);
    }
    box.replaceChildren(...out);
  });
  // Collapsed My bets header on Home: a one-line summary; tap to slide the bets down.
  dash.draw('mybetsum', (box) => {
    if (dash.data('bets').status !== 'ok' && rows('pubbets').length) { const pb = rows('pubbets'), rec = pb.find((x) => x.kind === 'record') || { won: 0, lost: 0 }, n = pb.filter((x) => x.kind === 'bet').length; box.textContent = (n ? n + ' open · ' : '') + rec.won + '-' + rec.lost; return; }
    const all = betRows(), open = all.filter(isOpen), settled = all.filter((b) => b.status === 'won' || b.status === 'lost');
    const won = settled.filter((b) => b.status === 'won').length, pr = settled.reduce((s, b) => s + profitOf(b), 0);
    box.textContent = [open.length ? open.length + ' open' : '', settled.length ? won + '-' + (settled.length - won) + ' · ' + money(pr) : ''].filter(Boolean).join(' · ') || 'No bets yet';
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
    { const st = dash.data('bets').status, sec = box.closest('section'); if (sec) sec.classList.toggle('isempty', st !== 'ok' && st !== 'loading'); if (st !== 'ok') return; }
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
  // The live row for one of our games: NBA / NFL by id, football by team names, and only on the day being
  // viewed (default: the day on screen), since the same teams can meet on back-to-back days.
  function liveOf(sp, ref, day) {
    const dd = day || X.selDay;
    const rs = liveRows('livegames').filter((r) => r.sport === sp && (!dd || !r.start_time || dayKey(new Date(r.start_time)) === dd));
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
  function liveHome(b, sp, ref, day) {
    const r = liveOf(sp, ref, day); if (!r || r.state === 'pre') return;
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
  const LVTAB = {}; // live box score: which team's tab is open, per game
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
      // one team at a time: a tab for each side (the choice is kept while the score refreshes)
      const sides = [[r.away_code, r.away_name], [r.home_code, r.home_name]].filter(([c]) => box.some((b) => b.team === c));
      const pick = LVTAB[r.espn_id] && sides.some(([c]) => c === LVTAB[r.espn_id]) ? LVTAB[r.espn_id] : (sides[0] || [])[0];
      const panes = {};
      if (sides.length > 1) {
        const bar = el('div', null, 'lvtabs'); bar.setAttribute('role', 'tablist');
        sides.forEach(([c, nm]) => { const b = el('button', String(nm || c).split(' ').slice(-1)[0] || c, 'lvtab' + (c === pick ? ' on' : '')); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(c === pick));
          b.addEventListener('click', (e) => { e.stopPropagation(); LVTAB[r.espn_id] = c; bar.querySelectorAll('.lvtab').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-selected', String(on)); }); Object.entries(panes).forEach(([k, d]) => { d.hidden = k !== c; }); });
          bar.append(b); });
        card.append(bar);
      }
      sides.map(([c]) => c).forEach((team) => {
        const pl = box.filter((b) => b.team === team).map((b) => { let s = {}; try { s = JSON.parse(b.stats || '{}'); } catch (e) { s = {}; } return { ...b, s }; });
        if (!pl.length) return;
        const pane = el('div', null, 'lvpane'); pane.hidden = team !== pick; panes[team] = pane; card.append(pane);
        if (sides.length < 2) pane.append(el('h3', team, 'lvteam'));
        const t = el('table', null, 'lvbox');
        if (sp === 'nba') {
          const hr = el('tr'); ['Player', 'MIN', 'PTS', 'REB', 'AST', '3PM'].forEach((x, i) => hr.append(el('th', x, i ? 'n' : ''))); t.append(hr);
          // starting five first, then the bench, each in ESPN's order (not sorted by points)
          const isSt = (p) => String(p.starter) === 'true';
          const ordered = pl.filter((p) => !p.s.dnp).map((p, i) => [p, i]).sort((a, b) => (isSt(b[0]) ? 1 : 0) - (isSt(a[0]) ? 1 : 0) || a[1] - b[1]).map((x) => x[0]);
          let lastSt = null;
          ordered.forEach((p) => {
            if (isSt(p) !== lastSt) { lastSt = isSt(p); const sr = el('tr', null, 'lvgrp'); const td = el('td', lastSt ? 'Starters' : 'Bench'); td.colSpan = 6; sr.append(td); t.append(sr); }
            const tr = el('tr'); const nm = el('td'); nm.append(el('b', p.player));
            const pts = Number(p.s.points || 0);
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
        const w = el('div', null, 'scroll'); w.append(t); pane.append(w);
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
      if (dx > 90 && dy < 60 && dx > 2 * dy && Date.now() - t0 < 900) { const b = backBtn(); if (b) b.click(); else if (X.navBack) X.navBack(); } // same as tapping Back
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
  // This game against the season: what the defence allowed in one finished game (gzones, fetch-game-zones.js) next to
  // its average over its other games this season. Lower FG% allowed is better, so green = tighter than usual.
  function zoneGame(team, id, day) {
    const all = rows('gzones').filter((r) => r.team === team); if (!all.length) return null;
    const g = all.find((r) => r.game === id && (!day || r.day === day)); if (!g) return null;
    const rest = all.filter((r) => r.ev !== g.ev); if (!rest.length) return null;
    const pc = (z) => (z && z[0] ? z[1] / z[0] : null);
    const sum = (k) => rest.reduce((a, r) => [a[0] + ((r.z[k] || [])[0] || 0), a[1] + ((r.z[k] || [])[1] || 0)], [0, 0]);
    const tot = (zs) => ZONES.reduce((a, [k]) => [a[0] + ((zs[k] || [])[0] || 0), a[1] + ((zs[k] || [])[1] || 0)], [0, 0]);
    const box = el('div', null, 'dgame'); box.append(el('h3', 'This game vs their average', 'dgh'));
    const gT = tot(g.z), sT = ZONES.reduce((a, [k]) => { const x = sum(k); return [a[0] + x[0], a[1] + x[1]]; }, [0, 0]);
    const gp = pc(gT), sp = pc(sT), d = gp != null && sp != null ? Math.round((gp - sp) * 100) : null;
    box.append(el('p', 'Allowed ' + g.opp + ' ' + gT[1] + ' of ' + gT[0] + ' (' + Math.round(gp * 100) + '%) against ' + Math.round(sp * 100) + '% on average over ' + rest.length + ' other games' + (d == null ? '.' : d === 0 ? ': about the same.' : d < 0 ? ': ' + -d + ' points tighter than usual.' : ': ' + d + ' points looser than usual.'), 'muted'));
    const tb = el('table', null, 'dtbl'); const hr = el('tr'); ['Zone', 'This game', 'Average', 'Diff'].forEach((h, j) => hr.append(el('th', h, j ? 'n' : ''))); tb.append(hr);
    ZONES.forEach(([k, l]) => {
      const z = g.z[k] || [0, 0], p = pc(z), a = sum(k), ap = pc(a), avgA = a[0] / rest.length;
      const tr = el('tr'); const dc = el('td', null, 'n');
      if (p != null && ap != null) { const dd = Math.round((p - ap) * 100); dc.append(el('span', (dd > 0 ? '+' : '') + dd, 'drk ' + (dd <= -5 ? 'g' : dd >= 5 ? 'r' : 'a'))); } else dc.textContent = '–';
      tr.append(el('td', l), el('td', z[0] ? z[1] + '/' + z[0] + ' · ' + Math.round(p * 100) + '%' : '0 shots', 'n'), el('td', ap == null ? '–' : Math.round(ap * 100) + '% · ' + avgA.toFixed(1) + ' shots', 'n'), dc);
      tb.append(tr);
    });
    const w = el('div', null, 'scroll'); w.append(tb); box.append(w);
    box.append(el('p', 'Diff is percentage points of field goal % allowed: green means they held this opponent below their usual, red means they allowed more. Averages come from every other game they have played this season.', 'muted'));
    return box;
  }
  function defCourt(id, day) {
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
      { const zg = zoneGame(team, id, day); if (zg) pane.append(zg); }
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

  // ---- Home: live now / next up, pick of the day, game of the night, injury alerts.
  // They follow the same day as Best bets (today, or tomorrow from 4 pm).
  const homeGroup = () => { try { return bestBets()[0] || null; } catch (e) { return null; } };
  const fmtLeft = (ms) => { const m = Math.max(1, Math.round(ms / 60000)), h = Math.floor(m / 60), d = Math.floor(h / 24); return d ? d + 'd ' + (h % 24) + 'h' : h ? h + 'h ' + (m % 60) + 'm' : m + 'm'; };
  const openPick = (i) => { const f = i.m.finder; if (f && f.side && window.SSPP) window.SSPP.focus(i.sp, f.stat, f.line, f.player, f.pid); else X.openGame(i.sp, i.id, i.day); };
  dash.draw('hslive', (box) => {
    clearInterval(box._t);
    const live = liveRows('livegames').filter((r) => r.state === 'in');
    if (live.length) {
      const row = el('div', null, 'hlrow');
      live.forEach((r) => {
        const c = el('button', null, 'hlc'); c.type = 'button';
        const top = el('div', null, 'hlt'); top.append(el('span', 'LIVE', 'hlive'), el('span', r.status_text || '', 'muted'));
        const side = (code, name, pts) => { const d = el('div', null, 'hls'); d.append(r.sport === 'nba' ? X.badge(code) : X.bdX(code), el('b', code || name), el('span', String(pts == null ? 0 : pts))); return d; };
        c.append(top, side(r.away_code, r.away_name, r.away_score), side(r.home_code, r.home_name, r.home_score));
        c.addEventListener('click', () => X.openGame(r.sport, r.game_id, dayKey(new Date(r.start_time)))); row.append(c);
      });
      box.replaceChildren(el('div', 'Live now · ' + live.length, 'hhl'), row); return;
    }
    const now = Date.now(), nx = rows('schedule').filter((x) => x.iso && new Date(x.iso).getTime() > now).sort((a, b) => (a.iso < b.iso ? -1 : 1))[0];
    if (!nx) { box.replaceChildren(); return; }
    const t = new Date(nx.iso).getTime(), c = el('button', null, 'hnext'); c.type = 'button';
    const lab = el('span', null, 'hnl'); lab.append(el('b', 'Next up'), document.createTextNode(' · ' + (nx.sport === 'fb' ? nx.home_name + ' v ' + nx.away_name : nx.away_name + ' @ ' + nx.home_name) + ' · ' + nx.kick));
    const cd = el('b', 'in ' + fmtLeft(t - now), 'hncd'); c.append(lab, cd);
    c.addEventListener('click', () => X.openGame(nx.sport, nx.id, nx.date));
    box.replaceChildren(c);
    box._t = setInterval(() => { const left = t - Date.now(); if (left <= 0) { clearInterval(box._t); dash.draw('hslive'); return; } cd.textContent = 'in ' + fmtLeft(left); }, 30000);
  });
  // Pick of the day: our strongest priced pick (game or player prop), leaving out anything with injury news or a
  // big gap to the bookie (those can mean the bookie knows something).
  dash.draw('hpod', (box) => {
    const sec = box.closest('section');
    if (!bbReady()) { if (sec) sec.classList.toggle('isempty', false); box.replaceChildren(skel(1)); return; }
    const g = homeGroup();
    const ok = (g ? [...g.plays, ...(g.bprops || [])] : []).filter((i) => PUB || (i.m.price >= 1.3 && !i.m.est)).filter((i) => { const f = i.m.finder; return !(f && f.why && f.why.some((w) => /big gap/.test(w))) && !(f && f.side && injOf(i.sp, f)); });
    const best = ok.sort((a, b) => b.m.chance - a.m.chance || b.m.price - a.m.price)[0];
    if (sec) sec.classList.toggle('isempty', !best); if (!best) { box.replaceChildren(); return; }
    const f = best.m.finder, c = el('button', null, 'hpodc'); c.type = 'button';
    const ic = bbIcon(best); ic.classList.add('big');
    const mid = el('div', null, 'hpm'); mid.append(el('span', g.key + (best.time ? ' · ' + best.time : ''), 'hpd'), el('b', best.m.pick, 'hpp'),
      el('span', f && f.side ? 'Over this line in ' + f.hit + ' games this season · avg ' + f.avg + ', last ' + (f.sp === 'nfl' ? 3 : 5) + ' ' + f.l5 : best.match, 'hpr'));
    const r = el('div', null, 'hpv'); r.append(el('b', best.m.chance + '%', 'c ' + conf(best.m.chance)), el('span', PUB || !best.m.price ? '' : '$' + best.m.price.toFixed(2) + (best.m.book ? ' ' + best.m.book.replace(' (AU)', '') : '')));
    c.append(ic, mid, r); c.addEventListener('click', () => openPick(best));
    box.replaceChildren(c);
  });
  // Game of the night: the best matchup on the slate (two strong records, a close projected margin).
  dash.draw('hgotn', (box) => {
    const sec = box.closest('section'), g = homeGroup(), day = g && g.key;
    const games = day ? rows('games').filter((x) => x.date === day && rows('pred').some((p) => p.id === x.id)) : [];
    const recOf = (id, code) => (rows('teams').find((t) => t.game === id && t.team === code) || {}).record || '';
    const wp = (rec) => { const m = String(rec).match(/(\d+)-(\d+)/); return m && +m[1] + +m[2] ? +m[1] / (+m[1] + +m[2]) : 0.5; };
    const top = games.map((x) => { const p = rows('pred').find((q) => q.id === x.id); return { x, p, s: wp(recOf(x.id, x.away)) + wp(recOf(x.id, x.home)) - Math.abs(Number(p.margin) || 0) / 15 }; }).sort((a, b) => b.s - a.s)[0];
    if (sec) sec.classList.toggle('isempty', !top); if (!top) { box.replaceChildren(); return; }
    const { x, p } = top, [an, hn] = String(x.matchup).split(' @ '), c = el('button', null, 'hgc'); c.type = 'button';
    const side = (code, name) => { const d = el('div', null, 'hgs'); d.append(X.badge(code), el('b', name || code), el('span', recOf(x.id, code), 'muted')); return d; };
    const mid = el('div', null, 'hgm'); mid.append(el('span', day + ' · ' + x.time), el('b', p.winner + ' by ' + Number(p.margin).toFixed(1)), el('span', (p.ml_final_prob ? p.ml_final_prob + '% to win · ' : '') + 'total ' + x.total, 'muted'));
    c.append(side(x.away, an), mid, side(x.home, hn)); c.addEventListener('click', () => X.openGame('nba', x.id, day));
    box.replaceChildren(c);
  });
  // New injuries: key players (12+ points or 25+ minutes a game this season) with an injury report in the last
  // 2 days for the coming games, and which of our picks are in their game. Older injuries are on the player pages.
  dash.draw('hinj', (box) => {
    const sec = box.closest('section'), g = homeGroup(), day = g && g.key;
    const games = day ? rows('games').filter((x) => x.date === day) : [];
    const teams = new Map(games.flatMap((x) => [[x.away, x], [x.home, x]]));
    const pgl = rows('pgl'); const cur = pgl.slice(0, 50).map((r) => String(r.g || '').split(',')[1] || '').sort().pop();
    const avgOf = (pid) => { const r = pgl.find((q) => String(q.pid) === String(pid)); if (!r) return null; const gs = String(r.g || '').split(';').map((v) => v.split(',')).filter((v) => v[1] === cur && +v[7] > 0 && v[21] !== '1'); return gs.length < 2 ? null : { pts: gs.reduce((t, v) => t + +v[8], 0) / gs.length, min: gs.reduce((t, v) => t + +v[7], 0) / gs.length }; };
    const picks = g ? [...g.plays, ...(g.alts || []), ...(g.bprops || [])] : [];
    const since = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10); // reported in the last 2 days
    const list = [];
    rows('troster').filter((t) => t.sp === 'nba' && teams.has(t.code)).forEach((t) => (t.inj || []).forEach((i) => {
      if (!/out|doubt|day|ques/i.test(i[3] || '') || !(i[6] && i[6] >= since)) return; const a = avgOf(i[0]); if (!a || (a.pts < 12 && a.min < 25)) return;
      const gm = teams.get(t.code), inGame = picks.filter((it) => it.sp === 'nba' && it.id === gm.id);
      list.push({ pid: i[0], name: i[1], team: t.code, status: i[3], what: i[4] || '', note: i[7] || '', a, gm, own: inGame.filter((it) => it.m.finder && it.m.finder.player === i[1]).length, game: inGame.filter((it) => !it.m.finder).map((it) => it.m.pick), props: inGame.filter((it) => it.m.finder && it.m.finder.player !== i[1]).length });
    }));
    list.sort((x, y) => (y.own + y.game.length + y.props ? 1 : 0) - (x.own + x.game.length + x.props ? 1 : 0) || y.a.pts - x.a.pts);
    if (sec) sec.classList.toggle('isempty', !list.length); if (!list.length) { box.replaceChildren(); return; }
    const out = list.slice(0, 6).map((x) => {
      const r = el('button', null, 'hir'); r.type = 'button';
      const t = el('div', null, 'hit'); t.append(el('b', x.name), el('span', x.team + ' · ' + x.a.pts.toFixed(1) + ' pts, ' + Math.round(x.a.min) + ' min a game · ' + x.gm.matchup, 'muted'));
      const aff = [x.own ? 'his prop' : '', ...x.game, x.props ? x.props + (x.props === 1 ? ' prop' : ' props') : ''].filter(Boolean);
      if (x.note) t.append(el('span', x.note, 'hinote'));
      if (aff.length) t.append(el('span', 'Affects ' + aff.join(' + '), 'hiaff'));
      const lab = /out/i.test(x.status) ? 'OUT' : /doubt/i.test(x.status) ? 'DOUBTFUL' : 'DAY-TO-DAY';
      r.append(X.avatar('nba', x.pid, x.name), t, el('span', lab, 'hist ' + (lab === 'OUT' ? 'out' : 'dbt')));
      r.addEventListener('click', () => X.openPlayer(x.name)); return r;
    });
    box.replaceChildren(...out, ...(list.length > 6 ? [el('p', '+' + (list.length - 6) + ' more on the team pages', 'muted bbnote')] : []));
  });
  // keep the countdown and live strip fresh when the live feed updates
  // ---- News (news.json, ESPN headlines; the local server refreshes it every 30 minutes)
  const newsRows = () => { const g = dash.data('news'); return g.status === 'ok' && Array.isArray(g.data) ? g.data : []; };
  const ago = (iso) => { const m = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000)); return m < 60 ? m + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago'; };
  // players in the news in the last 24 hours, by ESPN id (the same ids as our player data)
  const newsOf = (pid) => { if (pid == null) return []; const cut = Date.now() - 86400000; return newsRows().filter((x) => new Date(x.published).getTime() > cut && (x.athletes || []).some((a) => a[0] === String(pid))); };
  const newsItem = (x) => {
    const a = el('a', null, 'nwi'); a.href = x.link; a.target = '_blank'; a.rel = 'noopener noreferrer';
    const th = el('span', null, 'nwth' + (x.video ? ' vid' : '')); if (x.img) { const im = document.createElement('img'); im.src = x.img; im.alt = ''; im.loading = 'lazy'; th.append(im); }
    const t = el('span', null, 'nwt'); t.append(el('b', x.headline), el('small', x.league + ' · ' + ago(x.published) + (x.video ? ' · video' : '')));
    a.append(th, t); return a;
  };
  const NWF = { sp: 'all', more: false };
  dash.draw('hnews', (box) => {
    const sec = box.closest('section'), all = newsRows();
    if (sec) sec.classList.toggle('isempty', !all.length); if (!all.length) { box.replaceChildren(); return; }
    const SPN = { nba: 'NBA', nfl: 'NFL', fb: 'Football', ufc: 'UFC' }, sps = Object.keys(SPN).filter((k) => all.some((x) => x.sp === k));
    const chips = el('div', null, 'bbchips');
    const chip = (lab, k) => { const c = el('button', lab, 'bbchip' + (NWF.sp === k ? ' on' : '')); c.type = 'button'; c.addEventListener('click', () => { NWF.sp = k; NWF.more = false; dash.draw('hnews'); }); return c; };
    chips.append(chip('All', 'all'), ...sps.map((k) => chip(SPN[k], k)));
    const list = all.filter((x) => NWF.sp === 'all' || x.sp === NWF.sp), shown = list.slice(0, NWF.more ? 20 : 6);
    const out = [chips, ...shown.map(newsItem)];
    if (list.length > shown.length) { const m = el('button', 'More headlines ›', 'bbmore'); m.type = 'button'; m.addEventListener('click', () => { NWF.more = true; dash.draw('hnews'); }); out.push(m); }
    box.replaceChildren(...out);
  });
  // fresh headlines while the page stays open
  setInterval(() => { try { dash.refresh('news'); } catch (e) { /* not loaded */ } }, 10 * 60000);

  // Confidence colours on game cards everywhere (green 70%+, amber 60-69%, grey below), same as the Bets tab.
  // Cards already showing a result (won / lost) keep their result colours.
  const tintAll = () => document.querySelectorAll('.hg .pk:not([data-ct]), .gcard .pk:not([data-ct])').forEach((p) => {
    p.dataset.ct = '1'; const card = p.closest('.hg, .gcard'); if (card && /\b(won|lost|rgres|lvdone)\b/.test(card.className)) return;
    const m = p.textContent.match(/(\d+(?:\.\d+)?)%/); if (!m) return; const v = +m[1]; p.classList.add(v >= 70 ? 'cHi' : v >= 60 ? 'cMd' : 'cLo'); });
  new MutationObserver(() => { clearTimeout(tintAll.t); tintAll.t = setTimeout(tintAll, 60); }).observe(document.body, { childList: true, subtree: true });
  window.SSG = { newsOf, newsItem, defCourt, b2bCard, b2bInfo, gameBets, ufcMethods, ufcTabs, liveHome, betPill, candidates, mainCard, pickMain, liveCard, liveDecor, merge, slipChips, provisional };
})();
