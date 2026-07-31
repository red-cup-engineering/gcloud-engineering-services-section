#!/usr/bin/env bash
set -euo pipefail
project=five-six-one-group-dev
region=us-central1
image="${IMAGE:?set IMAGE to an immutable Artifact Registry image digest}"
gcloud run jobs deploy zero-custody-sxc-transition --project="$project" --region="$region" --image="$image" --service-account=zero-custody-sxc@five-six-one-group-dev.iam.gserviceaccount.com --tasks=1 --parallelism=1 --max-retries=0 --task-timeout=300s --network=default --subnet=default --vpc-egress=private-ranges-only --set-env-vars="CHAIN_RPC_URL=http://10.128.0.2:8563,BUNDLER_RPC_URL=http://10.128.0.2:8563,TRANSITION_KMS_KEY_VERSION=projects/five-six-one-group-dev/locations/us-central1/keyRings/zero-custody-semiotic/cryptoKeys/transition-signer/cryptoKeyVersions/1,TRANSITION_SIGNER_ADDRESS=0xe42035e55aaef429cac3235926d233101d37b585,BUNDLER_JOB_RUN_URL=https://run.googleapis.com/v2/projects/five-six-one-group-dev/locations/us-central1/jobs/erc4337-demand-raised:run"
