#!/usr/bin/env bash
# The bookmaker data (The Odds API, paid plan) lives on its own branch, "odds-data", as ONE commit that each
# run replaces, so the big, twice-daily files (player props alone are ~4 MB) never pile up in main's history.
#   pull  copy the files from the branch into public/data (they are git-ignored on main)
#   push  save public/data's copies back to the branch (a fresh single commit, force-pushed)
# Used by the cloud jobs (odds, results, picks, deploy) and by the Mac's local server (pull only).
# Usage: bash scripts/odds-branch.sh pull|push
set -euo pipefail
cd "$(dirname "$0")/.."
FILES=(odds.json props.json propbook.json altlines.json valuelog.json)
case "${1:-}" in
  pull)
    if ! git fetch -q origin odds-data 2>/dev/null; then echo "odds-data: no branch yet, nothing to pull"; exit 0; fi
    n=0
    for f in "${FILES[@]}"; do
      if git cat-file -e "origin/odds-data:$f" 2>/dev/null; then git show "origin/odds-data:$f" > "public/data/$f.tmp" && mv "public/data/$f.tmp" "public/data/$f"; n=$((n + 1)); fi
    done
    echo "odds-data: pulled $n files ($(git log -1 --format=%cd --date=iso origin/odds-data))"
    ;;
  push)
    entries=""
    for f in "${FILES[@]}"; do
      [ -s "public/data/$f" ] && entries+="100644 blob $(git hash-object -w "public/data/$f")	$f"$'\n'
    done
    [ -n "$entries" ] || { echo "odds-data: no files to push"; exit 0; }
    tree=$(printf '%s' "$entries" | git mktree)
    if git fetch -q origin odds-data 2>/dev/null && [ "$(git rev-parse 'origin/odds-data^{tree}')" = "$tree" ]; then echo "odds-data: unchanged"; exit 0; fi
    commit=$(git -c user.name="StatSniper data bot" -c user.email="actions@users.noreply.github.com" commit-tree "$tree" -m "Odds data $(date -u '+%F %H:%M') UTC")
    for i in 1 2 3; do git push -q -f origin "$commit:refs/heads/odds-data" && break; sleep 5; done
    echo "odds-data: pushed ($(printf '%s' "$entries" | grep -c .) files)"
    ;;
  *) echo "usage: bash scripts/odds-branch.sh pull|push"; exit 1 ;;
esac
