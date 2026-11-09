mkdir -p ~/statsniper-live && cd ~/statsniper-live
cat > index.js <<'SSEOF'
// StatSniper live: every minute (Cloud Scheduler -> this Cloud Function), read ESPN's free scoreboards for
// the NBA, NFL, Premier League, La Liga and Champions League. For each game that is live, or finished in
// the last few hours, read its ESPN summary and write the score, status, quarter / half scores, the
// player box score (NBA, NFL) and team stats with key events (football) to BigQuery
// (dataset statsniper_live). When nothing is live it only reads the scoreboards and writes nothing.
//
// Local test without BigQuery: DRY=1 node index.js   (prints what it would write)
const PROJECT = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'project-ab030f51-2215-481e-bfa';
const DS = '`' + PROJECT + '.statsniper_live`';
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/';
const SUM = 'https://site.web.api.espn.com/apis/site/v2/sports/';
const LEAGUES = [
  { sp: 'nba', league: 'NBA', path: 'basketball/nba' },
  { sp: 'nfl', league: 'NFL', path: 'football/nfl' },
  { sp: 'fb', league: 'Premier League', path: 'soccer/eng.1' },
  { sp: 'fb', league: 'La Liga', path: 'soccer/esp.1' },
  { sp: 'fb', league: 'Champions League', path: 'soccer/uefa.champions' },
];
const CODE = { nba: { GS: 'GSW', NO: 'NOP', NY: 'NYK', SA: 'SAS', UTAH: 'UTA', WSH: 'WAS' }, nfl: { JAX: 'JAC', LAR: 'LA', WSH: 'WAS' }, fb: {} };
const RECENT_HOURS = Number(process.env.RECENT_HOURS) || 5; // keep writing finished games this long after kick-off so the final score lands

async function getJson(url) {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(url, { headers: { 'User-Agent': 'StatSniper/1.0' } }); if (r.ok) return await r.json(); if (r.status === 404) return null; } catch (e) { /* retry */ }
    await new Promise((res) => setTimeout(res, 400 * (i + 1)));
  }
  return null;
}
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// One game from a scoreboard event.
function gameRow(L, ev) {
  const c = ev.competitions[0], st = c.status || ev.status || {}, t = st.type || {};
  const H = c.competitors.find((x) => x.homeAway === 'home'), A = c.competitors.find((x) => x.homeAway === 'away');
  const code = (x) => { const a = x.team.abbreviation; return CODE[L.sp][a] || a; };
  const ls = (x) => (x.linescores || []).map((q) => num(q.value ?? q.displayValue));
  const hl = ls(H), al = ls(A);
  return {
    sport: L.sp, league: L.league, espn_id: String(ev.id),
    game_id: L.sp === 'fb' ? null : code(A) + '-' + code(H),
    start_time: new Date(ev.date).toISOString(), state: t.state || '', status_text: t.shortDetail || t.detail || '',
    period: num(st.period), clock: st.displayClock || '',
    home_code: code(H), away_code: code(A), home_name: H.team.displayName, away_name: A.team.displayName,
    home_score: num(H.score), away_score: num(A.score),
    linescore: JSON.stringify(hl.map((v, i) => [v, al[i] ?? null])), extra: null,
  };
}
// Player lines from an ESPN summary: NBA has one stat group, NFL one per category (passing, rushing …).
function boxRows(L, g, s) {
  const out = [];
  for (const tp of (s && s.boxscore && s.boxscore.players) || []) {
    const team = (CODE[L.sp][tp.team.abbreviation] || tp.team.abbreviation);
    const byAth = new Map();
    for (const grp of tp.statistics || []) {
      const keys = grp.keys || grp.names || grp.labels || [];
      for (const a of grp.athletes || []) {
        if (!a.athlete) continue;
        const id = String(a.athlete.id);
        const row = byAth.get(id) || { sport: L.sp, espn_id: g.espn_id, game_id: g.game_id, team, player_id: id, player: a.athlete.displayName, starter: !!a.starter, stats: {} };
        if (a.didNotPlay) row.stats.dnp = a.reason || 'DNP';
        (a.stats || []).forEach((v, i) => { const k = keys[i]; if (k) row.stats[L.sp === 'nfl' ? grp.name + '.' + k : k] = v; });
        if (a.starter) row.starter = true;
        byAth.set(id, row);
      }
    }
    byAth.forEach((r) => out.push({ ...r, stats: JSON.stringify(r.stats) }));
  }
  return out;
}
// Football: team stats and key events (goals, cards, substitutions left out).
function fbExtra(s) {
  const teams = ((s && s.boxscore && s.boxscore.teams) || []).map((t) => ({ team: t.team.abbreviation, ha: t.homeAway, st: Object.fromEntries((t.statistics || []).filter((x) => ['possessionPct', 'totalShots', 'shotsOnTarget', 'wonCorners', 'foulsCommitted', 'yellowCards', 'redCards', 'saves', 'offsides'].includes(x.name)).map((x) => [x.name, x.displayValue])) }));
  const ev = ((s && s.keyEvents) || []).filter((k) => /goal|card|penalty/i.test((k.type && k.type.text) || '')).map((k) => ({ t: (k.clock && k.clock.displayValue) || '', type: k.type.text, team: k.team && k.team.displayName, text: String(k.shortText || k.text || '').slice(0, 120) }));
  return JSON.stringify({ teams, events: ev });
}

async function collect() {
  const now = Date.now(), games = [], box = [];
  for (const L of LEAGUES) {
    const sb = await getJson(SITE + L.path + '/scoreboard');
    for (const ev of (sb && sb.events) || []) {
      const t = (ev.status && ev.status.type) || {};
      const start = new Date(ev.date).getTime();
      const live = t.state === 'in', recent = t.state === 'post' && now - start < RECENT_HOURS * 3600000;
      if (!live && !recent) continue;
      const g = gameRow(L, ev);
      const s = await getJson(SUM + L.path + '/summary?event=' + ev.id);
      if (L.sp === 'fb') g.extra = fbExtra(s); else box.push(...boxRows(L, g, s));
      games.push(g);
    }
  }
  return { games, box };
}

// One BigQuery script: upsert the games, replace those games' box lines, drop rows older than 2 days.
const SQL = `
MERGE ${DS}.live_games T
USING (
  SELECT JSON_VALUE(j,'$.sport') sport, JSON_VALUE(j,'$.league') league, JSON_VALUE(j,'$.espn_id') espn_id, JSON_VALUE(j,'$.game_id') game_id,
    TIMESTAMP(JSON_VALUE(j,'$.start_time')) start_time, JSON_VALUE(j,'$.state') state, JSON_VALUE(j,'$.status_text') status_text,
    SAFE_CAST(JSON_VALUE(j,'$.period') AS INT64) period, JSON_VALUE(j,'$.clock') clock,
    JSON_VALUE(j,'$.home_code') home_code, JSON_VALUE(j,'$.away_code') away_code, JSON_VALUE(j,'$.home_name') home_name, JSON_VALUE(j,'$.away_name') away_name,
    SAFE_CAST(JSON_VALUE(j,'$.home_score') AS INT64) home_score, SAFE_CAST(JSON_VALUE(j,'$.away_score') AS INT64) away_score,
    JSON_VALUE(j,'$.linescore') linescore, JSON_VALUE(j,'$.extra') extra
  FROM UNNEST(JSON_QUERY_ARRAY(PARSE_JSON(@games))) j
) S
ON T.sport = S.sport AND T.espn_id = S.espn_id
WHEN MATCHED THEN UPDATE SET league = S.league, game_id = S.game_id, start_time = S.start_time, state = S.state, status_text = S.status_text, period = S.period, clock = S.clock,
  home_code = S.home_code, away_code = S.away_code, home_name = S.home_name, away_name = S.away_name, home_score = S.home_score, away_score = S.away_score,
  linescore = S.linescore, extra = S.extra, updated_at = CURRENT_TIMESTAMP()
WHEN NOT MATCHED THEN INSERT (sport, league, espn_id, game_id, start_time, state, status_text, period, clock, home_code, away_code, home_name, away_name, home_score, away_score, linescore, extra, updated_at)
  VALUES (S.sport, S.league, S.espn_id, S.game_id, S.start_time, S.state, S.status_text, S.period, S.clock, S.home_code, S.away_code, S.home_name, S.away_name, S.home_score, S.away_score, S.linescore, S.extra, CURRENT_TIMESTAMP());
DELETE FROM ${DS}.live_box WHERE espn_id IN (SELECT JSON_VALUE(j,'$.espn_id') FROM UNNEST(JSON_QUERY_ARRAY(PARSE_JSON(@games))) j);
INSERT INTO ${DS}.live_box (sport, espn_id, game_id, team, player_id, player, starter, stats, updated_at)
  SELECT JSON_VALUE(j,'$.sport'), JSON_VALUE(j,'$.espn_id'), JSON_VALUE(j,'$.game_id'), JSON_VALUE(j,'$.team'), JSON_VALUE(j,'$.player_id'), JSON_VALUE(j,'$.player'),
    SAFE_CAST(JSON_VALUE(j,'$.starter') AS BOOL), JSON_VALUE(j,'$.stats'), CURRENT_TIMESTAMP()
  FROM UNNEST(JSON_QUERY_ARRAY(PARSE_JSON(@box))) j;
DELETE FROM ${DS}.live_games WHERE updated_at < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 48 HOUR);
DELETE FROM ${DS}.live_box WHERE updated_at < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 48 HOUR);
`;

async function write({ games, box }) {
  if (!games.length) return 'nothing live';
  const { BigQuery } = require('@google-cloud/bigquery');
  const bq = new BigQuery({ projectId: PROJECT });
  await bq.query({ query: SQL, params: { games: JSON.stringify(games), box: JSON.stringify(box) }, location: 'US' });
  return `${games.length} games, ${box.length} player lines`;
}

// Cloud Functions (gen2) HTTP entry point, called by Cloud Scheduler every minute.
exports.poll = async (req, res) => {
  try { const data = await collect(); const msg = await write(data); console.log(msg); res.status(200).send(msg); } catch (e) { console.error(e); res.status(500).send(String(e.message || e)); }
};
exports.SQL = SQL; exports.collect = collect;

if (require.main === module && process.env.DRY) {
  collect().then((d) => { console.log(JSON.stringify({ games: d.games.length, box: d.box.length, sample: d.games.slice(0, 2), boxSample: d.box.slice(0, 2) }, null, 1)); });
}
SSEOF
cat > package.json <<'SSEOF'
{
  "name": "statsniper-live",
  "version": "1.0.0",
  "private": true,
  "main": "index.js",
  "engines": { "node": ">=22" },
  "dependencies": {
    "@google-cloud/bigquery": "^7.9.0",
    "@google-cloud/functions-framework": "^3.4.0"
  }
}
SSEOF
cat > deploy.sh <<'SSEOF'
#!/usr/bin/env bash
# StatSniper live: deploy the Cloud Function and its every-minute schedule.
# Run in Google Cloud Shell from the folder holding index.js, package.json and this file:
#   bash deploy.sh
set -euo pipefail
PROJECT=project-ab030f51-2215-481e-bfa
REGION=us-central1
FN=statsniper-live

gcloud config set project "$PROJECT"
gcloud services enable cloudfunctions.googleapis.com run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com cloudscheduler.googleapis.com bigquery.googleapis.com logging.googleapis.com

NUM=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
SA="${NUM}-compute@developer.gserviceaccount.com"

# The function runs as the default compute account: let it write to BigQuery and build the function.
for ROLE in roles/bigquery.dataEditor roles/bigquery.jobUser roles/cloudbuild.builds.builder roles/logging.logWriter roles/artifactregistry.writer; do
  gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" --role="$ROLE" --condition=None --quiet >/dev/null
done

gcloud functions deploy "$FN" --gen2 --runtime=nodejs22 --region="$REGION" --source=. \
  --entry-point=poll --trigger-http --no-allow-unauthenticated \
  --memory=256Mi --timeout=55s --max-instances=1 --service-account="$SA"

URL=$(gcloud functions describe "$FN" --gen2 --region="$REGION" --format='value(serviceConfig.uri)')
gcloud functions add-invoker-policy-binding "$FN" --gen2 --region="$REGION" --member="serviceAccount:$SA" >/dev/null

# Every minute, all day: when nothing is on it only reads ESPN's scoreboards and writes nothing.
if gcloud scheduler jobs describe "$FN" --location="$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "$FN" --location="$REGION" --schedule="* * * * *" --uri="$URL" \
    --http-method=GET --oidc-service-account-email="$SA" --oidc-token-audience="$URL"
else
  gcloud scheduler jobs create http "$FN" --location="$REGION" --schedule="* * * * *" --uri="$URL" \
    --http-method=GET --oidc-service-account-email="$SA" --oidc-token-audience="$URL"
fi

echo
echo "Test run:"
gcloud scheduler jobs run "$FN" --location="$REGION"
sleep 20
gcloud functions logs read "$FN" --gen2 --region="$REGION" --limit=5
echo
echo "Done. StatSniper live is checking games every minute."
SSEOF
bash deploy.sh
