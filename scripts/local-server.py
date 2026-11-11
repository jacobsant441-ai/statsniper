#!/usr/bin/env python3
"""Local StatSniper server with live scores.

Serves public/ like server.js does, and adds the `livegames` and `livebox`
datasets by reading BigQuery (dataset statsniper_live) through the `bq` CLI,
using whatever Google login is active on this Mac. Read-only. Results are
cached for CACHE_SECONDS so the page's 30 s refresh never hammers BigQuery.

Run:  python3 scripts/local-server.py          (PORT=8080 to change the port)
"""
import json, os, subprocess, sys, threading, time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "public"
PORT = int(os.environ.get("PORT", "3000"))
PROJECT = os.environ.get("GCP_PROJECT", "project-ab030f51-2215-481e-bfa")
CACHE_SECONDS = 25
ENV = {**os.environ, "PATH": "/opt/homebrew/bin:/usr/local/bin:" + os.environ.get("PATH", "")}

FMT = "FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', {c})"
QUERIES = {
    "livegames": f"SELECT * REPLACE({FMT.format(c='start_time')} AS start_time, {FMT.format(c='updated_at')} AS updated_at) "
                 f"FROM `{PROJECT}.statsniper_live.live_games`",
    "livebox": f"SELECT * REPLACE({FMT.format(c='updated_at')} AS updated_at) "
               f"FROM `{PROJECT}.statsniper_live.live_box`",
}
INT_COLS = {"period", "home_score", "away_score"}
BOOL_COLS = {"starter"}
EXTRA_MANIFEST = {
    "livegames": {"title": "Live games", "description": "Live scores from BigQuery (local feed).", "updated": ""},
    "livebox": {"title": "Live box scores", "description": "Live box scores from BigQuery (local feed).", "updated": ""},
    # private, Mac only: listed here (not in manifest.json) so the cloud's manifest updates never clash with local edits
    "valuelog": {"title": "Track record", "description": "Every bet we rated, settled from results (value-log.js).", "updated": ""},
    "news": {"title": "News", "description": "Latest ESPN headlines for every sport (fetch-news.js, every 30 minutes).", "updated": ""},
}

_cache, _lock = {}, threading.Lock()


def clean(row):
    for k, v in row.items():
        if v is None:
            continue
        if k in INT_COLS:
            row[k] = int(v)
        elif k in BOOL_COLS:
            row[k] = str(v).lower() == "true"
    return row


def query(name):
    with _lock:
        hit = _cache.get(name)
        if hit and time.time() - hit[0] < CACHE_SECONDS:
            return hit[1]
        out = subprocess.run(
            ["bq", f"--project_id={PROJECT}", "query", "--use_legacy_sql=false",
             "--format=json", "--max_rows=10000", QUERIES[name]],
            capture_output=True, text=True, timeout=40, env=ENV)
        if out.returncode != 0:
            if hit:  # serve stale data rather than failing
                return hit[1]
            raise RuntimeError(out.stderr.strip() or "bq failed")
        rows = [clean(r) for r in json.loads(out.stdout or "[]")]
        _cache[name] = (time.time(), rows)
        return rows


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/data/manifest.json":
            m = json.loads((ROOT / "data" / "manifest.json").read_text())
            return self._json({**m, **{k: v for k, v in EXTRA_MANIFEST.items() if k not in m}})
        for name in QUERIES:
            if path == f"/data/{name}.json":
                try:
                    return self._json(query(name))
                except Exception as e:
                    sys.stderr.write(f"[live] {name}: {e}\n")
                    return self._json([])  # page treats no rows as nothing live
        return super().do_GET()

    def list_directory(self, path):
        """No folder listings: only the app's own pages and data files are served, by exact name."""
        self.send_error(404, "Not found")
        return None

    def end_headers(self):
        if not self.path.startswith("/data/live"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        if "/data/live" in str(args[0] if args else ""):
            sys.stderr.write("[live] " + fmt % args + "\n")


def autopull():
    """Keep this Mac's copy current: the cloud commits fresh results to GitHub every ~30 min, so pull them
    (fast-forward only, never overwrites local edits). Set NO_AUTOPULL=1 to turn off."""
    import time
    n = 0
    while True:
        # latest news every 30 minutes (every 6th 5-minute pass), from the first pass on
        if n % 6 == 0:
            try:
                subprocess.run(["node", "scripts/fetch-news.js"], cwd=str(ROOT.parent), capture_output=True, text=True, timeout=120, env=ENV)
            except Exception as e:
                sys.stderr.write("[news] fetch failed: %s\n" % e)
        n += 1
        try:
            r = subprocess.run(["git", "pull", "--ff-only", "-q"], cwd=str(ROOT.parent), capture_output=True, text=True, timeout=120, env=ENV)
            if r.returncode:
                sys.stderr.write("[git] pull skipped: " + (r.stderr.strip() or r.stdout.strip())[:200] + "\n")
        except Exception as e:
            sys.stderr.write("[git] pull failed: %s\n" % e)
        settle_bets()
        time.sleep(300)


def settle_bets():
    """Settle logged bets from final results (private: bets.json stays on this Mac, never in git).
    Keeps the previous copy in ~/Desktop/StatSniper/backups if anything changed."""
    f = ROOT / "data" / "bets.json"
    try:
        before = f.read_bytes() if f.exists() else b""
        subprocess.run(["node", "scripts/grade-bets.js"], cwd=str(ROOT.parent), capture_output=True, text=True, timeout=120, env=ENV)
        # public site: publish the cleaned copies (open bets + record, our picks, no money or prices) when they
        # change. Off until ~/Desktop/StatSniper/publish-public.on exists (the owner turns it on).
        if (Path.home() / "Desktop" / "StatSniper" / "publish-public.on").exists():
            r = subprocess.run(["node", "scripts/export-public.js", "--upload"], cwd=str(ROOT.parent), capture_output=True, text=True, timeout=120, env=ENV)
            if r.returncode:
                sys.stderr.write("[public] export failed: " + (r.stderr.strip() or r.stdout.strip())[:200] + "\n")
        # value track record (valuelog.json, private): settle finished game / alt / prop bets (no credits)
        subprocess.run(["node", "scripts/value-log.js", "grade"], cwd=str(ROOT.parent), capture_output=True, text=True, timeout=120, env=ENV)
        if f.exists() and f.read_bytes() != before and before:
            bk = Path.home() / "Desktop" / "StatSniper" / "backups"
            if bk.is_dir():
                (bk / "bets-before-last-auto-settle.json").write_bytes(before)
    except Exception as e:
        sys.stderr.write("[bets] settle failed: %s\n" % e)


if __name__ == "__main__":
    if not os.environ.get("NO_AUTOPULL"):
        threading.Thread(target=autopull, daemon=True).start()
    print(f"StatSniper (with live scores) on http://localhost:{PORT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
