# StatSniper

*Sharp picks, broken down.* A daily picks app covering the **NBA, football (Premier League, La Liga and Champions League), the NFL and the UFC**: each game's most likely result, win chances, lines, team and player stats, injuries and lineups, player props, same-game slips, and a **Review** tab that grades the picks against final scores.

This is a standalone rebuild of the StatSniper dashboard that originally ran as a claude.ai artifact. It needs no dependencies and no build step.

## Run it

You need Node 18 or newer (Node 22 for the data scripts' proxy support), and Python 3 with Pillow for the logo and photo scripts.

```bash
npm start
```

Then open http://localhost:3000. To use another port, run `PORT=8080 npm start`.

The app has to be served over HTTP. Opening `index.html` straight from disk (`file://`) won't work because the browser blocks the data requests.

## The website (fast, installable)

```bash
npm run build:web
```
```bash
npm run preview
```

`build:web` writes a ready-to-host static site to `dist/web`; `preview` serves it at http://localhost:4173. Compared with serving `public/` directly it:

- writes the page straight into `index.html`, so nothing is fetched and injected first;
- loads data files under 300 KB before the first draw and the large ones (player logs, photos) only when a screen needs them: about 1 MB compressed on a first visit instead of about 10 MB;
- versions every file by content hash, so a service worker can cache it: repeat visits open in a fraction of a second and work offline;
- includes a web app manifest and icons, so it can be installed on a phone home screen or desktop.

### Hosting and daily refresh

`.github/workflows/refresh-and-deploy.yml` runs every morning (6:17 am Sydney): it pulls fresh ESPN data (NBA logs, UFC fighters, Champions League, NFL and football players, team schedules; logos and photos on Mondays), commits it, builds `dist/web` and publishes it to GitHub Pages. It also redeploys on every push to `main` and can be run by hand from the Actions tab.

One-time setup after pushing to GitHub: **Settings > Pages > Build and deployment > Source: GitHub Actions**.

The hand-researched data (NBA picks, lines, injuries, lineups, notes, slips, the daily review, NFL and UFC picks, Premier League and La Liga picks) is not in a feed, so it only changes when it is edited.

## How it's put together

```
server.js                 zero-dependency static file server
public/
  index.html              app shell and theme tokens
  dash-runtime.js         local stand-in for the dashboard host (the `dash` API)
  page.html               the StatSniper UI: markup, styles and all app logic
  logos*.js               team and league logos as data URLs
  data/
    manifest.json         every dataset's title, description and last update
    <id>.json             one file per dataset (rows as JSON)
```

`dash-runtime.js` loads every file listed in `data/manifest.json`, puts `page.html` on the page, and runs its scripts. It provides the API the page was written against:

- `dash.data(id)` returns `{status, data, columns}`.
- `dash.draw(name, fn)` runs `fn(el)` on each `[data-draw="name"]` element that isn't hidden. It runs again when the window is resized and when a hidden section is shown.
- `dash.setLink`, `dash.params`, `dash.setParams` and `dash.calc` are also provided.

## Datasets

| File | What's in it |
| --- | --- |
| `games` | NBA games per Sydney (AEDT) day: lines, records, over/under counts |
| `pred` | Projected result, moneyline pick, win chance and confidence per game |
| `teams`, `log`, `ladder` | Team splits, season game logs and the totals ladder |
| `lineups`, `notes` | Starting fives, injuries and per-game notes |
| `players`, `pstats`, `plog`, `top`, `props75`, `slips` | Player props, hit rates and same-game slips |
| `final`, `boxes`, `pact`, `review`, `history` | Final scores, box scores and graded results |
| `schedule` | Upcoming NBA schedule |
| `fixtures`, `table`, `results` | Football fixtures, tables and results |
| `nflgames`, `nflinfo`, `nfltable`, `nflresults` | NFL games, matchup details, teams and results |
| `ufcevents`, `ufcfights` | UFC cards and bouts |

### Updating the data

1. Replace or edit the matching `public/data/<id>.json` file. Keep each file as an array of row objects with the same field names.
2. Update that dataset's `updated` entry in `manifest.json`.
3. Reload the page.

Dates and times are in Sydney time (AEDT). The calendar opens on today's date in Sydney.

To add a new dataset, add an entry to `manifest.json` and a `data/<id>.json` file. Then read it in `page.html` with `dash.data('<id>')`.

> Picks and lines are estimates built from public stats and posted lines. Lines move, so check with the book before you rely on any of them.
