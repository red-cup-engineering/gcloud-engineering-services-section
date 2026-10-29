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
traffic operation. A consumer establishes its HTTPS actor origin
before asking for cutover: this operation reads the named staged revision and refuses
unless its required `serving.knative.dev/service` label identifies that service
and its `BASE_URL` and
`ACTIVITYPUB_ORIGIN` equal that exact origin.

Managed task scheduling belongs to
`gcloud-runtime-authorities-service`, which owns its authenticated Cloud Tasks
adapter and immutable-custody boundary. Cloud Run Jobs remain diagnostic and
repair tools, not normal delivery workers.

## Cloud Run Job image transactions

`transact-cloud-run-job-image` is the generic image-only mutation membrane for
an existing Job. The requested image must be digest-pinned. The caller supplies
fresh `CloudRunJobMutationPauseObservation` and `CloudRunJobIdleObservation`
records, each bound to the exact project, region, and Job and carrying
`observedAt`/`expiresAt`. The actuator validates those observations but neither
observes nor changes their external pause authority.

The operation describes the Job, normalizes its v1 or v2 desired specification,
updates only `--image`, and describes it again. A successful
`CloudRunJobImageTransactionReceipt` proves that every other normalized desired
field survived. Any update error or mismatched readback causes a compensating
update to the prior image and a second full desired-spec comparison; the typed
error reports whether compensation was verified.

`observeCloudRunJobDesiredSpec` owns the corresponding read-only precondition:
it describes the Job, normalizes the live v1/v2 document, and proves equality
with one previously captured normalized desired spec. A transaction may repeat
that same law through `expectedCurrentDesiredSpec` immediately before mutation,
closing the gap between a consumer's rollback plan and its effect without
granting this owner Scheduler authority.

Library consumers may use `normalizeCloudRunJobDesiredSpec` directly. The CLI
accepts the same operation through its ordinary JSON input file, for example:

```json
{
  "operation": "transact-cloud-run-job-image",
  "project": "example-project",
  "region": "us-central1",
  "job": "example-job",
  "image": "us-central1-docker.pkg.dev/example-project/jobs/example@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "pauseObservation": {
    "type": "CloudRunJobMutationPauseObservation",
    "subject": { "project": "example-project", "region": "us-central1", "job": "example-job" },
    "authority": "urn:example:release-controller",
    "paused": true,
    "observedAt": "2026-08-16T12:00:00.000Z",
    "expiresAt": "2026-08-16T12:05:00.000Z"
  },
  "idleObservation": {
    "type": "CloudRunJobIdleObservation",
    "subject": { "project": "example-project", "region": "us-central1", "job": "example-job" },
    "activeExecutions": [],
    "observedAt": "2026-08-16T12:00:00.000Z",
    "expiresAt": "2026-08-16T12:05:00.000Z"
  }
}
```

## Execution outcomes

`normalizeCloudRunJobExecution` maps live-shaped v1 `Completed` conditions and
v2 `terminalCondition` states onto one `CloudRunJobExecutionState` with typed
task counts, outcome, and terminal exit evidence. `processExitCode` is explicitly
`null`: Cloud Run reports an execution condition, not necessarily a container
process exit status, and the actuator does not invent one.

`wait-cloud-run-job-execution` repeatedly describes one named execution until it
returns a `CloudRunJobExecutionTerminalReceipt` or exhausts its bounded
`maxAttempts`. Library callers may inject `pause`; CLI callers use the bounded
`pollIntervalMilliseconds` value in their JSON request.
