#!/usr/bin/env bash
set -euo pipefail

: "${GOOGLE_CLOUD_PROJECT:?set GOOGLE_CLOUD_PROJECT}"

for command in gcloud curl; do command -v "$command" >/dev/null || { echo "missing required command: $command" >&2; exit 69; }; done

service=${CLOUD_RUN_SERVICE:-gcloud-cloud-run-actuator}
region=${CLOUD_RUN_REGION:-us-central1}
repository=${ARTIFACT_REPOSITORY:-union-actuators}
image_tag=${IMAGE_TAG:-$(date -u +%Y%m%dT%H%M%SZ)}
image="${region}-docker.pkg.dev/${GOOGLE_CLOUD_PROJECT}/${repository}/${service}:${image_tag}"
root=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
url=$(gcloud run services describe "$service" --project "$GOOGLE_CLOUD_PROJECT" --region "$region" --format='value(status.url)' 2>/dev/null || true)
deploy_args=(run deploy "$service" --project "$GOOGLE_CLOUD_PROJECT" --region "$region" --image "$image" --allow-unauthenticated --quiet)
if [[ -n "$url" ]]; then deploy_args+=(--set-env-vars "BASE_URL=$url"); else deploy_args+=(--clear-env-vars); fi

gcloud builds submit "$root" --project "$GOOGLE_CLOUD_PROJECT" --config "$root/ops/cloud-run/cloudbuild.yaml" --substitutions "_IMAGE=$image"
gcloud "${deploy_args[@]}"
if [[ -z "$url" ]]; then
  url=$(gcloud run services describe "$service" --project "$GOOGLE_CLOUD_PROJECT" --region "$region" --format='value(status.url)')
  gcloud run services update "$service" --project "$GOOGLE_CLOUD_PROJECT" --region "$region" --update-env-vars "BASE_URL=$url" --quiet
fi
curl --fail --silent --show-error "$url/.well-known/agent-card.json" >/dev/null
printf 'actor_url=%s\nactor=%s\n' "$url" "urn:ame:gcloud-cloud-run-actuator-service"
