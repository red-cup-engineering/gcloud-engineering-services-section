# GCloud Cloud Run Actuator control plane

This package exposes only a local CLI and library API for bounded `gcloud` Cloud
Run operations. It does not advertise or operate an ActivityPub, A2A, or HTTP
control-plane interface. Historical carrier files remain for provenance; they
are not an activation path.

## Declared service reconciliation

The bounded `reconcile-cloud-run-service` operation deploys the declared image,
then makes the declared Cloud Run domain mapping converge: it leaves a matching
mapping unchanged, creates a missing mapping, and refuses a mapping routed to a
different service. The checked-in `content/desired-state/wuxian-gui.json`
declares the current public `wuxian-gui` service, its required runtime
configuration, and `gui.561.group` mapping without embedding a machine-local
path.

## Deployment boundary

This actor owns generic cloud execution, so deployment controls belong in this
service rather than a consumer's laptop script. `deploy-cloud-run-service`
accepts only an image pinned by `@sha256:` and always stages it with
`--no-traffic`; `cutover-cloud-run-service` is the separate, explicit 100%
traffic operation. A consumer establishes its canonical HTTPS actor origin
before asking for cutover: this operation reads the named staged revision and refuses
unless its required `serving.knative.dev/service` label identifies that service
and its `BASE_URL` and
`ACTIVITYPUB_ORIGIN` equal that exact origin.

Managed task scheduling belongs to
`gcloud-runtime-authorities-service`, which owns its authenticated Cloud Tasks
adapter and immutable-custody boundary. Cloud Run Jobs remain diagnostic and
repair tools, not normal delivery workers.
