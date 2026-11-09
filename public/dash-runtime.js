// StatSniper local runtime.
// Stands in for the claude.ai dashboard host: loads every dataset from
// /data/<id>.json, injects page.html, runs its scripts in order, and
// provides the same `dash` API the page was written against.
(() => {
  const root = document.getElementById('dash-root');
  const store = new Map();        // id -> {status, data, columns, meta, message}
  const draws = new Map();        // name -> fn | {mount, update, unmount}
  const mounted = new WeakMap();  // el -> value returned by mount()
  const listeners = [];           // dash.onData callbacks
  const calcs = new Map();        // id -> {inputs, fn, title, description}
  let params = {};
  let booted = false;
  let WEB = null;                 // web build: {id: {v, lazy}} from the page's ss-web tag
  const inflight = new Map();     // id -> promise, so each file is fetched once

  const toRows = (raw) => {
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object') {
      for (const k of ['rows', 'data', 'results']) if (Array.isArray(raw[k])) return raw[k];
    }
    return raw;
  };
  const columnsOf = (rows) => {
    if (!Array.isArray(rows)) return [];
    const seen = new Set();
    rows.forEach((r) => r && typeof r === 'object' && Object.keys(r).forEach((k) => seen.add(k)));
    return [...seen];
  };

  const visible = (el) => el.isConnected && !el.closest('[hidden]');

  const runOne = (name, el) => {
    const d = draws.get(name);
    if (!d) return;
    try {
      if (typeof d === 'function') {
        d(el);
      } else {
        if (!mounted.has(el)) { el.replaceChildren(); mounted.set(el, d.mount ? d.mount(el) : undefined); }
        if (d.update) d.update(el, mounted.get(el));
      }
    } catch (err) {
      console.error(`[dash] drawing "${name}" threw`, err);
      if (typeof d === 'object' && d.unmount && mounted.has(el)) { try { d.unmount(el, mounted.get(el)); } catch (e) {} mounted.delete(el); }
    }
  };

  const runDraw = (name) => {
    if (!booted) return;
    document.querySelectorAll(`[data-draw="${CSS.escape(name)}"]`).forEach((el) => { if (visible(el)) runOne(name, el); });
  };

  const runAll = (scope = document) => {
    if (!booted) return;
    listeners.forEach((fn) => { try { fn(); } catch (e) { console.error('[dash] onData threw', e); } });
    scope.querySelectorAll('[data-draw]').forEach((el) => { if (visible(el)) runOne(el.dataset.draw, el); });
  };

  const dash = {
    data(id) {
      if (calcs.has(id)) {
        const c = calcs.get(id);
        const ins = c.inputs.map((i) => dash.data(i));
        if (ins.some((g) => g.status !== 'ok')) return { status: 'loading', data: [], columns: [], meta: [], refreshing: false };
        try {
          const out = c.fn(...ins.map((g) => g.data));
          return { status: 'ok', data: out, rows: out, value: out, columns: columnsOf(out), meta: [], refreshing: false };
        } catch (e) {
          return { status: 'error', message: String(e), data: [], columns: [], meta: [], refreshing: false };
        }
      }
      const s = store.get(id);
      if (!s && WEB && WEB[id]) { lazyLoad(id); return { status: 'loading', data: [], columns: [], meta: [], refreshing: false }; }
      if (!s) return { status: booted ? 'missing' : 'loading', data: [], columns: [], meta: [], refreshing: false };
      return { ...s, rows: s.data, value: s.data, refreshing: false };
    },
    draw(name, fn) {
      if (fn !== undefined) { draws.set(name, fn); if (booted) runDraw(name); return; }
      runDraw(name);
    },
    onData(fn) { listeners.push(fn); if (booted) fn(); },
    calc(id, spec) { calcs.set(id, spec); },
    loader() { /* only used by live connector queries; local data is already rows */ },
    refresh(id) { return loadDataset(id).then(() => runAll()); },
    colors: ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'],
    params: () => ({ ...params }),
    setParams(p) { for (const k in p) { if (p[k] == null) delete params[k]; else params[k] = p[k]; } runAll(); },
    resetParams() { params = {}; runAll(); },
    setLink(name) { try { history.replaceState(null, '', name ? '#' + name : location.pathname); } catch (e) {} },
  };
  window.dash = dash;

  // Single-file build (dist/statsniper.html) embeds the page and data in the
  // document instead of serving them as separate files.
  const embedded = (id) => document.getElementById(id);
  const readJson = (id) => JSON.parse(embedded(id).textContent);

  async function loadDataset(id) {
    try {
      let raw;
      if (embedded('ss-manifest')) {
        raw = readJson('ss-data-' + id);
      } else {
        // Web build: each file's URL carries a content hash, so the browser can cache it for good.
        const res = WEB && WEB[id] ? await fetch(`data/${id}.json?v=${WEB[id].v}`) : await fetch(`data/${id}.json`, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        raw = await res.json();
      }
      const data = toRows(raw);
      store.set(id, { status: 'ok', data, columns: columnsOf(data), meta: [] });
    } catch (e) {
      store.set(id, { status: 'error', message: String(e), data: [], columns: [], meta: [] });
      console.error(`[dash] dataset "${id}" failed to load`, e);
    }
  }

  // Large files load the first time a drawing asks for them; every drawing then redraws.
  function lazyLoad(id) {
    if (inflight.has(id)) return inflight.get(id);
    let redraw = null;
    const p = loadDataset(id).then(() => { if (booted) { clearTimeout(redraw); redraw = setTimeout(() => runAll(), 0); } });
    inflight.set(id, p); return p;
  }

  async function runScripts(container) {
    for (const old of [...container.querySelectorAll('script')]) {
      const s = document.createElement('script');
      for (const a of old.attributes) s.setAttribute(a.name, a.value);
      // Like the hosted dashboard: each script runs in its own scope (share through window).
      if (old.src) {
        let code = '';
        try { code = await (await fetch(old.getAttribute('src'))).text(); } catch (e) { console.error('[dash] failed to load', old.src); }
        s.removeAttribute('src'); s.textContent = '(function(){\n' + code + '\n})();';
        old.replaceWith(s);
      } else {
        s.textContent = '(function(){\n' + old.textContent + '\n})();';
        old.replaceWith(s);
      }
    }
  }

  function watch() {
    // A drawing under `hidden` doesn't run; run it when it is revealed.
    let pending = new Set();
    new MutationObserver((muts) => {
      muts.forEach((m) => { if (!m.target.hasAttribute('hidden')) pending.add(m.target); });
      if (pending.size) queueMicrotask(() => {
        const els = pending; pending = new Set();
        els.forEach((t) => {
          if (!visible(t)) return;
          if (t.dataset && t.dataset.draw) runOne(t.dataset.draw, t);
          t.querySelectorAll('[data-draw]').forEach((el) => { if (visible(el)) runOne(el.dataset.draw, el); });
        });
      });
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden'] });

    let lastW = window.innerWidth, t = null;
    window.addEventListener('resize', () => {
      clearTimeout(t);
      t = setTimeout(() => { if (window.innerWidth !== lastW) { lastW = window.innerWidth; runAll(); } }, 150);
    });
  }

  // Web build (dist/web): page markup is already in the document, small data files
  // load before the first draw, large ones on demand. See scripts/build-web.js.
  if (embedded('ss-web')) {
    WEB = readJson('ss-web');
    window.DASH_MANIFEST = WEB;
    const eager = Object.keys(WEB).filter((id) => !WEB[id].lazy);
    const parsed = new Promise((ok) => (document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', ok) : ok()));
    Promise.all([parsed, ...eager.map(lazyLoad)]).then(() => {
      booted = true; runAll(); watch();
      // Warm the search names once the first screen is up.
      const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1200));
      idle(() => { if (WEB.pidx) lazyLoad('pidx'); });
    });
    return;
  }

  // Single-file build: page markup and scripts are already in the document and
  // the data is in JSON tags, so load everything synchronously and draw once the
  // document has parsed. Nothing is fetched or injected.
  if (embedded('ss-manifest')) {
    const manifest = readJson('ss-manifest');
    window.DASH_MANIFEST = manifest;
    Object.keys(manifest).forEach((id) => {
      try {
        const data = toRows(readJson('ss-data-' + id));
        store.set(id, { status: 'ok', data, columns: columnsOf(data), meta: [] });
      } catch (e) {
        store.set(id, { status: 'error', message: String(e), data: [], columns: [], meta: [] });
      }
    });
    const start = () => { booted = true; runAll(); watch(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
    return;
  }

  async function boot() {
    const isEmbedded = false;
    const manifest = isEmbedded ? readJson('ss-manifest') : await fetch('data/manifest.json').then((r) => r.json());
    window.DASH_MANIFEST = manifest;
    const [html] = await Promise.all([
      isEmbedded ? embedded('ss-page').innerHTML : fetch('page.html').then((r) => r.text()),
      ...Object.keys(manifest).map(loadDataset),
    ]);
    root.innerHTML = html;
    await runScripts(root);
    booted = true;
    document.dispatchEvent(new Event('DOMContentLoaded'));
    runAll();
    watch();
  }

  boot().catch((e) => {
    console.error(e);
    root.textContent = 'StatSniper failed to start: ' + e.message + '. Serve this folder over HTTP (npm start), not file://.';
  });
})();
