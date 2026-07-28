#!/usr/bin/env bash
set -euo pipefail

: "${GOOGLE_CLOUD_PROJECT:?set GOOGLE_CLOUD_PROJECT}"
: "${ACTUATOR_BEARER_TOKEN:?set a high-entropy ACTUATOR_BEARER_TOKEN for deploy/invoke authority}"

for command in gcloud mktemp curl; do command -v "$command" >/dev/null || { echo "missing required command: $command" >&2; exit 69; }; done

service=${CLOUD_RUN_SERVICE:-gcloud-cloud-run-actuator}
region=${CLOUD_RUN_REGION:-us-central1}
repository=${ARTIFACT_REPOSITORY:-union-actuators}
image_tag=${IMAGE_TAG:-$(date -u +%Y%m%dT%H%M%SZ)}
image="${region}-docker.pkg.dev/${GOOGLE_CLOUD_PROJECT}/${repository}/${service}:${image_tag}"
root=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)

gcloud builds submit "$root" --project "$GOOGLE_CLOUD_PROJECT" --config "$root/ops/cloud-run/cloudbuild.yaml" --substitutions "_IMAGE=$image"
gcloud run deploy "$service" --project "$GOOGLE_CLOUD_PROJECT" --region "$region" --image "$image" --no-allow-unauthenticated --set-env-vars "ACTUATOR_BEARER_TOKEN=$ACTUATOR_BEARER_TOKEN" --quiet
url=$(gcloud run services describe "$service" --project "$GOOGLE_CLOUD_PROJECT" --region "$region" --format='value(status.url)')
gcloud run services update "$service" --project "$GOOGLE_CLOUD_PROJECT" --region "$region" --update-env-vars "BASE_URL=$url" --quiet
token=$(gcloud auth print-identity-token)
curl --fail --silent --show-error --header "Authorization: Bearer $token" "$url/.well-known/agent-card.json" >/dev/null
printf 'actor_url=%s\nactor=%s\n' "$url" "urn:ame:gcloud-cloud-run-actuator-service"
