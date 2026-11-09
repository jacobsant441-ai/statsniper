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
