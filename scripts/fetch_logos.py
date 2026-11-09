"""Builds public/logos_nba.js, logos_epl.js, logos_laliga.js and logos_nfl.js: current NBA, football (Premier League, La Liga) and NFL team logos
as small WebP data URLs keyed by StatSniper's team codes, from ESPN's public feed.
Prefers ESPN's dark-background variant of each logo, since the app is dark.

Usage: python3 scripts/fetch_logos.py   (needs Pillow)
"""
import base64
import io
import json
import os
import sys
import urllib.request

from PIL import Image

PUB = os.path.join(os.path.dirname(__file__), '..', 'public')
SIZE = 128
# One file per league: the dashboard host stores each page file separately, up to 256 KB.
LEAGUES = [
    ('basketball/nba', 'logos_nba.js', {'GS': 'GSW', 'NO': 'NOP', 'NY': 'NYK', 'SA': 'SAS', 'UTAH': 'UTA', 'WSH': 'WAS'}),
    ('soccer/eng.1', 'logos_epl.js', {'BHA': 'BRI', 'CHE': 'CFC', 'LIV': 'LFC', 'MNC': 'MCI', 'MAN': 'MUN'}),
    ('soccer/esp.1', 'logos_laliga.js', {'CEL': 'RCC', 'RAY': 'RVC', 'BET': 'RBB', 'VAL': 'VCF'}),
    ('football/nfl', 'logos_nfl.js', {'JAX': 'JAC', 'LAR': 'LA', 'WSH': 'WAS'}),
]


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'StatSniper/1.0'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def logo_urls(team):
    """Dark-background variants first, then the standard logo."""
    logos = team.get('logos') or []
    urls = []
    for want in (('full', 'dark'), ('default', 'dark'), ('full', 'default'), ('default',)):
        for lg in logos:
            if all(w in lg.get('rel', []) for w in want) and lg['href'] not in urls:
                urls.append(lg['href'])
    urls += [lg['href'] for lg in logos if lg['href'] not in urls]
    return urls


def to_webp(png):
    im = Image.open(io.BytesIO(png)).convert('RGBA')
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)
    im.thumbnail((SIZE, SIZE), Image.LANCZOS)
    canvas = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    canvas.paste(im, ((SIZE - im.width) // 2, (SIZE - im.height) // 2), im)
    buf = io.BytesIO()
    canvas.save(buf, 'WEBP', quality=80, method=6)
    return 'data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode()


def main():
    for path, fname, remap in LEAGUES:
        logos = {}
        data = json.loads(get(f'https://site.api.espn.com/apis/site/v2/sports/{path}/teams'))
        for t in (x['team'] for x in data['sports'][0]['leagues'][0]['teams']):
            code = remap.get(t['abbreviation'], t['abbreviation'])
            for href in logo_urls(t):
                try:
                    logos[code] = to_webp(get(href))
                    break
                except Exception as e:  # a listed variant can be missing; try the next
                    print('  skip', t['abbreviation'], href.rsplit('/', 2)[-2:], e)
            else:
                print('no logo for', t['displayName'])
        var = 'NBA_LOGOS' if fname == 'logos_nba.js' else 'TEAM_LOGOS'  # NBA and NFL codes overlap, so NBA keeps its own map
        js = f'window.{var}=Object.assign(window.{var}||{{}},' + json.dumps(logos, separators=(',', ':')) + ');\n'
        with open(os.path.join(PUB, fname), 'w') as f:
            f.write(js)
        print(f'{path}: {len(logos)} logos -> public/{fname} ({len(js) / 1024:.0f} KB)')



def ucl():
    """Champions League clubs from outside the Premier League and La Liga, from the
    club list fetch-ucl.js writes (so the codes match the fixtures and table)."""
    path = os.path.join(PUB, 'data', 'ucl_teams.json')
    if not os.path.exists(path):
        print('no data/ucl_teams.json yet: run npm run fetch:ucl first')
        return
    logos = {}
    for t in json.load(open(path)):
        if t.get('domestic'):
            continue  # already in logos_epl.js / logos_laliga.js
        for href in logo_urls(t):
            try:
                logos[t['code']] = to_webp(get(href))
                break
            except Exception as e:
                print('  skip', t['code'], e)
        else:
            print('no logo for', t['name'])
    js = 'window.TEAM_LOGOS=Object.assign(window.TEAM_LOGOS||{},' + json.dumps(logos, separators=(',', ':')) + ');\n'
    with open(os.path.join(PUB, 'logos_ucl.js'), 'w') as f:
        f.write(js)
    print(f'uefa.champions: {len(logos)} logos -> public/logos_ucl.js ({len(js) / 1024:.0f} KB)')

if __name__ == '__main__':
    if sys.argv[1:] == ['ucl']:
        ucl()
    else:
        main()
        ucl()
