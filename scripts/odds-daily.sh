#!/bin/zsh
# Bookie prices on this Mac (needs the paid Odds API plan: about 15,000 of 20,000 credits a month).
#   morning ("am", ~8:15am Sydney): game prices (winner / line / total, all sports), NBA alternate lines and every
#     NBA player market for today's games, NFL player markets for today + tomorrow
#   evening ("pm", ~8:15pm Sydney): the same for tomorrow's NBA games (early prices), game prices again
# Then rates every line (prop-finder.js, nfl-prop-finder.js) and saves them in the track record (value-log.js).
# Everything it writes stays private on this Mac
# (props.json, propbook.json); the public propfind.json it touches is put back so git pulls keep working.
#
# The API key is read from the macOS Keychain, never a file. Add it once (it asks for the key; paste it):
#   security add-generic-password -a "$USER" -s statsniper-odds -w
# Turn the schedule on / off:
#   launchctl load   ~/Library/LaunchAgents/com.statsniper.odds.plist
#   launchctl unload ~/Library/LaunchAgents/com.statsniper.odds.plist
# Log: ~/Desktop/StatSniper/logs/odds-daily.log
set -u
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin
cd "${0:A:h}/.." || exit 1
LOG=~/Desktop/StatSniper/logs; mkdir -p "$LOG"
exec >>"$LOG/odds-daily.log" 2>&1
echo "=== $(TZ=Australia/Sydney date) ${1:-am}"
KEY=$(security find-generic-password -a "$USER" -s statsniper-odds -w 2>/dev/null) || { echo "No Odds API key in the Keychain (see top of this file)."; exit 1; }
git pull --ff-only -q || echo "git pull skipped (local changes or unpushed commits); using the games already here"
day() { TZ=Australia/Sydney date -v+${1}d '+%a %-d %b'; }
KEEP=${KEEP:-300}
if [[ "${1:-am}" == "pm" ]]; then
  NBA_DAY=$(day 1)
  ODDS_API_KEY=$KEY node scripts/fetch-odds.js --force | tail -1 || true
  ODDS_API_KEY=$KEY node scripts/fetch-alt-lines.js "$NBA_DAY" --keep=$KEEP | sed -n "1p;/altlines.json/p" || true
  ODDS_API_KEY=$KEY node scripts/fetch-props.js "$NBA_DAY" --all --keep=$KEEP || true
else
  NBA_DAY=$(day 0)
  ODDS_API_KEY=$KEY node scripts/fetch-odds.js --force | tail -1 || true
  ODDS_API_KEY=$KEY node scripts/fetch-alt-lines.js "$NBA_DAY" --keep=$KEEP | sed -n "1p;/altlines.json/p" || true
  ODDS_API_KEY=$KEY node scripts/fetch-props.js "$NBA_DAY" --all --keep=$KEEP || true
  for d in 0 1; do ODDS_API_KEY=$KEY node scripts/fetch-props.js "$(day $d)" --sport=nfl --all --keep=$KEEP || true; done
fi
node scripts/prop-finder.js "$NBA_DAY" | sed -n 1p
node scripts/nfl-prop-finder.js | sed -n 1p
node scripts/value-log.js snap
git checkout -q -- public/data/propfind.json 2>/dev/null || true
echo "done"
