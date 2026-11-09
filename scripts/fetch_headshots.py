"""Downloads ESPN headshots for every player and fighter in StatSniper's data files and
writes them as small square WebP data URLs, one file per sport:
  public/data/hs_nba.json, hs_nfl.json, hs_soc.json, hs_ufc.json  ->  [{"id": ..., "img": ...}]
Players without an ESPN photo are left out (the app shows initials instead).

Usage: python3 scripts/fetch_headshots.py [nba|nfl|soc|ufc|ufc_hd|uclx ...]   (needs Pillow)
uclx adds FotMob photos to hs_soc.json for Champions League projected starters and injured players
that ESPN has no photo for (ESPN has few football headshots). Keyed by ESPN id, or 'fm<FotMob id>'
when the player has no ESPN profile. 'soc' runs it too, so a soc refresh keeps them.
ufc_hd writes hs_ufc_hd.json: large 3:4 portraits of the fighters on upcoming cards (fight page).
"""
import base64
import io
import json
import os
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

DATA = os.path.join(os.path.dirname(__file__), '..', 'public', 'data')
SIZE = 132  # px square; sharp at 44px on 3x screens
SPLIT_BYTES = 7_500_000  # datasets must stay under 8 MB: larger sets are split into hs_<sp>.json and hs_<sp>2.json
SPORTS = {
    # sport: (source data file, id field, ESPN headshot folder)
    'nba': ('pgl.json', 'pid', 'nba'),
    'nfl': ('nflp.json', 'pid', 'nfl'),
    'soc': ('socp.json', 'pid', 'soccer'),
    'ufc': ('ufcp.json', 'id', 'mma'),
}


def fetch(folder, pid):
    url = f'https://a.espncdn.com/combiner/i?img=/i/headshots/{folder}/players/full/{pid}.png&w=320&h=233&scale=crop&cquality=85'
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'StatSniper/1.0'})
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return pid, None
        raise
    except Exception:
        return pid, None
    im = Image.open(io.BytesIO(raw)).convert('RGBA')
    if not im.getbbox():
        return pid, None
    w, h = im.size
    side = min(w, h)
    im = im.crop(((w - side) // 2, 0, (w - side) // 2 + side, side)).resize((SIZE, SIZE), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'WEBP', quality=72, method=6)
    return pid, 'data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode()


def fetch_portrait(pid):
    """Full-size ESPN headshot, cropped to a 3:4 portrait for the fight page."""
    url = f'https://a.espncdn.com/i/headshots/mma/players/full/{pid}.png'
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'StatSniper/1.0'})
        with urllib.request.urlopen(req, timeout=30) as r:
            im = Image.open(io.BytesIO(r.read())).convert('RGBA')
    except Exception:
        return pid, None
    if not im.getbbox():
        return pid, None
    w, h = im.size
    cw = min(w, round(h * 3 / 4))
    im = im.crop(((w - cw) // 2, 0, (w - cw) // 2 + cw, h)).resize((300, 400), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'WEBP', quality=82, method=6)
    return pid, 'data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode()


def ufc_hd():
    """Large portraits for every fighter on an upcoming card -> hs_ufc_hd.json."""
    import unicodedata
    norm = lambda s: unicodedata.normalize('NFD', str(s)).encode('ascii', 'ignore').decode().lower().replace('(c)', '').strip()
    prof = {norm(r['name']): str(r['id']) for r in json.load(open(os.path.join(DATA, 'ufcp.json')))}
    fights = json.load(open(os.path.join(DATA, 'ufcfights.json')))
    ids = sorted({prof[norm(n)] for f in fights for n in (f.get('a'), f.get('b')) if n and norm(n) in prof})
    with ThreadPoolExecutor(12) as ex:
        got = [(pid, img) for pid, img in ex.map(fetch_portrait, ids) if img]
    out = os.path.join(DATA, 'hs_ufc_hd.json')
    with open(out, 'w') as f:
        json.dump([{'id': pid, 'img': img} for pid, img in got], f, separators=(',', ':'))
    print(f'ufc_hd: {len(got)} of {len(ids)} fighters on upcoming cards, {os.path.getsize(out) / 1024 / 1024:.2f} MB')


def fetch_fotmob(key, fmid):
    url = f'https://images.fotmob.com/image_resources/playerimages/{fmid}.png'
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'})
        with urllib.request.urlopen(req, timeout=30) as r:
            im = Image.open(io.BytesIO(r.read())).convert('RGBA')
    except Exception:
        return key, None
    if not im.getbbox():
        return key, None
    w, h = im.size
    side = min(w, h)
    im = im.crop(((w - side) // 2, 0, (w - side) // 2 + side, side)).resize((SIZE, SIZE), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'WEBP', quality=72, method=6)
    return key, 'data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode()


def uclx():
    path = os.path.join(DATA, 'uclx.json')
    if not os.path.exists(path):
        print('uclx: no uclx.json yet, skipped')
        return
    out = os.path.join(DATA, 'hs_soc.json')
    hs = json.load(open(out)) if os.path.exists(out) else []
    have = {str(r['id']) for r in hs}
    want = {}
    for r in json.load(open(path)):
        for t in (r.get('xi') or {}).values():
            for p in (t or {}).get('players', []):
                if len(p) > 6 and p[6] and str(p[0]) not in have:
                    want[str(p[0])] = p[6]
        for lst in (r.get('inj') or {}).values():
            for i in lst:
                key = str(i[0]) if i[0] else f'fm{i[5]}'
                if i[5] and key not in have:
                    want[key] = i[5]
    with ThreadPoolExecutor(12) as ex:
        got = [(k, img) for k, img in ex.map(lambda kv: fetch_fotmob(*kv), want.items()) if img]
    with open(out, 'w') as f:
        json.dump(hs + [{'id': k, 'img': img} for k, img in got], f, separators=(',', ':'))
    print(f'uclx: {len(got)} of {len(want)} FotMob photos added, hs_soc {os.path.getsize(out) / 1024 / 1024:.2f} MB')


def write_split(sp, rows):
    """hs_<sp>.json, plus hs_<sp>2.json for the second half when one file would pass 8 MB."""
    one = json.dumps(rows, separators=(',', ':'))
    part2 = os.path.join(DATA, f'hs_{sp}2.json')
    if len(one) <= SPLIT_BYTES:
        open(os.path.join(DATA, f'hs_{sp}.json'), 'w').write(one)
        if os.path.exists(part2):
            os.remove(part2)
        print(f'  hs_{sp}.json {len(one) / 1e6:.2f} MB')
        return
    h = len(rows) // 2
    for name, part in ((f'hs_{sp}.json', rows[:h]), (f'hs_{sp}2.json', rows[h:])):
        txt = json.dumps(part, separators=(',', ':'))
        open(os.path.join(DATA, name), 'w').write(txt)
        print(f'  {name} {len(txt) / 1e6:.2f} MB')


def main():
    wanted = sys.argv[1:] or list(SPORTS) + ['ufc_hd']
    if 'ufc_hd' in wanted:
        ufc_hd()
        wanted = [w for w in wanted if w != 'ufc_hd']
    run_uclx = 'uclx' in wanted or 'soc' in wanted
    wanted = [w for w in wanted if w != 'uclx']
    for sp in wanted:
        src, key, folder = SPORTS[sp]
        path = os.path.join(DATA, src)
        if not os.path.exists(path):
            print(sp, ': no', src, 'yet, skipped')
            continue
        ids = [str(r[key]) for r in json.load(open(path))]
        with ThreadPoolExecutor(16) as ex:
            got = [(pid, img) for pid, img in ex.map(lambda p: fetch(folder, p), ids) if img]
        write_split(sp, [{'id': pid, 'img': img} for pid, img in got])
        print(f'{sp}: {len(got)} of {len(ids)} have photos')
    if run_uclx:
        uclx()


if __name__ == '__main__':
    main()
