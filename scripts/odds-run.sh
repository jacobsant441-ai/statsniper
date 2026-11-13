#!/usr/bin/env bash
# One bookmaker-prices run (The Odds API, paid plan: about 15,000 of the 20,000 monthly credits).
#   am (~8:15 am Sydney): game prices for every sport (UFC: winner and total rounds in fight week, 2 credits), NBA alternate lines and every NBA player market for
#      today's games, NFL player markets for today and tomorrow
#   pm (~8:15 pm Sydney): game prices again, plus alternate lines and every player market for tomorrow's NBA games
# Then rates every line with our own models (prop-finder.js, nfl-prop-finder.js) and snapshots them into the
# track record (value-log.js). The key comes from the ODDS_API_KEY environment variable (a GitHub secret in the
# cloud), never a file. Each fetch script checks the credits left first and stops before going under KEEP.
# Usage: ODDS_API_KEY=… bash scripts/odds-run.sh am|pm
set -u
cd "$(dirname "$0")/.."
[ -n "${ODDS_API_KEY:-}" ] || { echo "ODDS_API_KEY is not set"; exit 1; }
day() { TZ=Australia/Sydney date -d "+$1 day" '+%a %-d %b' 2>/dev/null || TZ=Australia/Sydney date -v+"$1"d '+%a %-d %b'; }
KEEP=${KEEP:-300}
MODE=${1:-am}
if [ "$MODE" = pm ]; then NBA_DAY=$(day 1); else NBA_DAY=$(day 0); fi
echo "odds run: $MODE, NBA slate $NBA_DAY"
node scripts/fetch-odds.js --force | tail -2 || echo "::warning::game prices failed"
node scripts/ufc-reprice.js || echo "::warning::UFC reprice failed"   # live prices and picks into the fight cards (ufcfights.json, main)
node scripts/fetch-alt-lines.js "$NBA_DAY" --keep=$KEEP | sed -n "1p;/altlines.json/p" || echo "::warning::alt lines failed"
node scripts/fetch-props.js "$NBA_DAY" --all --keep=$KEEP || echo "::warning::NBA props failed"
if [ "$MODE" = am ]; then
  for d in 0 1; do node scripts/fetch-props.js "$(day $d)" --sport=nfl --all --keep=$KEEP || echo "::warning::NFL props failed"; done
fi
node scripts/prop-finder.js "$NBA_DAY" | sed -n 1p || true
node scripts/nfl-prop-finder.js | sed -n 1p || true
node scripts/value-log.js snap || true
