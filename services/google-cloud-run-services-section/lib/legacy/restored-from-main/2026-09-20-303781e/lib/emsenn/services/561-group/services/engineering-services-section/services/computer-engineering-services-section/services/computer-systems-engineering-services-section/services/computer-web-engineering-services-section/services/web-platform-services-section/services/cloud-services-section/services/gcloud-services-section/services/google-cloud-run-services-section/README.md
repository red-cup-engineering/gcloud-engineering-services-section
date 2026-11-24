# 561 Group Google Cloud Run resource instances

This section owns the corporation's declarations and observations of its ephemeral Google Cloud Run machines.
It answers which project, region, service, revision, image, environment, Secret Manager references, invocation policy, traffic policy, runtime limits, and domain belong to a resource instance.

It does not execute `gcloud`, build an image, read a developer credential, or move traffic.
Those effects remain with `@red-cup-engineering/gcloud-cloud-run-actuator-service`.
This package emits the actuator's bounded request objects and admits its discovery receipts.

## Observed and desired are different records

`content/resources/notebooklm-inference-team.observed.json` transcribes the provider-authored deployment declaration currently present in the NotebookLM package.
Its evidence kind says exactly that: it is historical checked-in evidence, not a fresh Google control-plane observation.

`content/resources/notebooklm-inference-team.desired.json` is the machine owner's desired projection.
It declares the current public invocation policy, the three existing pinned Secret Manager references, exact selectable provider environment values, and supported runtime choices.
Missing signing, inbox, artifact-capability, witness-journal, image, and release evidence remains explicitly unresolved.
`formCloudRunServiceDeploymentRequest()` therefore returns a typed refusal until those owners supply exact declarations; it does not invent an image tag or Secret Manager resource.
A live `discover-cloud-run-service` receipt can be converted into a current observation with `projectCloudRunServiceObservation()`.

## Image construction is a selection before it is authority

`imageConstruction` records the Docker Hub index request, exact linux/amd64 child manifest and config, familiar digest-pinned Dockerfile base, Debian snapshot and exact package requests, Python venv, numeric runtime identity, filesystem paths, port, and shutdown budget.
It does not pretend that a registry response is the source-authorized base-image observation, or that the provider is already an admitted release.

`projectNodeRuntimeContainerImageConstructionInput(resource, evidence)` accepts the separately admitted provider requirement, matching release identities, and content-addressed `OciImageObservation`.
The OCI request is the tag-free `registry-1.docker.io/library/node@sha256:<index>` plus an exact platform; the Dockerfile selection remains `node:<version>-<suite>@sha256:<child-manifest>`.
Until all three inputs arrive the function returns a typed refusal.
Once they do, it returns the raw OCI observation and provider-owner outputs beside the corporation's exact authority selections.
The constructor owner remains responsible for admitting and projecting those values into its own grammar.
This package neither imports nor impersonates the provider verifier, constructor, or OCI reader.

The runtime network declaration distinguishes `{ "mode": "none" }`, which uses Cloud Run's provider-default networking and emits no network flags, from an explicit `direct-vpc` declaration containing network, subnetwork, and egress.
The runtime declaration is now closed over min/max scale, gen2, CPU throttling, startup boost, port 8080, public ingress, deploy-time health checking, and exact startup/readiness/liveness probes.
All three probes use the provider-owned, side-effect-free `GET /healthz` route.
The actuator projects these choices into gcloud 578 flags and verifies their v1/v2 readback; provider-default networking still emits no invented VPC arguments.

The section does not own NotebookLM customer allocations, settlement accounts, notebook data roots, customer artifact roots, or YouTube schedules.
Those remain with their respective enterprises.

## Consumer sequence

1. Load the resource with `loadCloudRunResourceInstance()`.
2. Send `formCloudRunServiceDiscoveryRequest(resource)` to the existing Cloud Run actuator.
3. Admit the returned receipt with `projectCloudRunServiceObservation(resource, receipt)`.
4. Close every unresolved desired declaration from its authoritative owner.
5. Send the output of `formCloudRunServiceDeploymentRequest(resource)` to the actuator for no-traffic staging.
6. Pass that exact receipt to `projectStagedCloudRunServiceObservation()`; the actuator admission must prove the named tag routes to the digest-pinned revision while that revision owns zero production traffic.
7. After independent endpoint verification at the tagged origin, form the separately gated cutover request with `formCloudRunServiceCutoverRequest(resource, originEnvironmentBindings)`.

The two effect requests are intentionally separate.
A build or ready revision is not permission to receive production traffic.

This package does not hardcode which environment variables cutover binds to the provider origin — that is the deploying enterprise's own declaration, not a generic Cloud Run fact.
The caller supplies its exact `originEnvironmentBindings` (a nonempty array of environment names); NotebookLM's deployment, for example, always binds both `ACTIVITYPUB_ORIGIN` and `NOTEBOOKLM_ARTIFACT_BASE_URL`.
The names are projected in sorted order for the actuator receipt preimage.

## Install

```
npm install @red-cup-engineering/google-cloud-run-services-section
```

Node 22+ is required.

## Usage

```js
import {
  loadCloudRunResourceInstance,
  formCloudRunServiceDiscoveryRequest,
  projectCloudRunServiceObservation,
  formCloudRunServiceDeploymentRequest,
  projectStagedCloudRunServiceObservation,
  formCloudRunServiceCutoverRequest,
} from "@red-cup-engineering/google-cloud-run-services-section";
import { discoverCloudRunService, deployCloudRunService } from "@red-cup-engineering/gcloud-cloud-run-actuator-service";

const resource = loadCloudRunResourceInstance();

// 1. Discover current provider state.
const discoveryReceipt = await discoverCloudRunService(formCloudRunServiceDiscoveryRequest(resource));
const observation = projectCloudRunServiceObservation(resource, discoveryReceipt);

// 2. Once every field in content/resources/*.desired.json is filled in,
//    stage a new revision with zero production traffic.
const deployRequest = formCloudRunServiceDeploymentRequest(resource);
const stageReceipt = await deployCloudRunService(deployRequest, { /* gcloud runner */ });
const staged = projectStagedCloudRunServiceObservation(resource, stageReceipt);

// 3. After verifying the staged (tagged, no-traffic) revision independently,
//    cut traffic over to it, naming the exact environment variables this
//    deployment binds to its provider origin.
const cutoverRequest = formCloudRunServiceCutoverRequest(resource, ["ACTIVITYPUB_ORIGIN", "NOTEBOOKLM_ARTIFACT_BASE_URL"]);
```

## API

- `loadCloudRunResourceInstance()` — reads and validates the two JSON files under `content/resources/`, returns a `GoogleCloudRunResourceInstance`.
- `formCloudRunResourceInstance({ observed, desired })` — builds the same structure from in-memory records instead of the files.
- `formCloudRunServiceDiscoveryRequest(resource)` — the actuator's `discover-cloud-run-service` request for this resource.
- `projectCloudRunServiceObservation(resource, actuatorReceipt)` — turns a discovery receipt into a `GoogleCloudRunServiceObservation`.
- `projectNodeRuntimeContainerImageConstructionInput(resource, evidence)` — see "Image construction is a selection before it is authority," above.
- `formCloudRunServiceDeploymentRequest(resource)` — the actuator's `deploy-cloud-run-service` request (a no-traffic staged deploy tagged `candidate`), or a refusal listing unresolved desired fields.
- `projectStagedCloudRunServiceObservation(resource, actuatorStageReceipt)` — validates a staged deploy receipt and returns the resulting zero-traffic `GoogleCloudRunServiceObservation`.
- `formCloudRunServiceCutoverRequest(resource, originEnvironmentBindings)` — the actuator's `cutover-cloud-run-service` request, gated on an explicit named revision, a 100% traffic admission, and a nonempty `originEnvironmentBindings` array of environment names supplied by the caller; binds each of those names to the origin.
- `NOTEBOOKLM_CLOUD_RUN_RESOURCE` — the resource URN constant.

## Tests

```
npm test
```
