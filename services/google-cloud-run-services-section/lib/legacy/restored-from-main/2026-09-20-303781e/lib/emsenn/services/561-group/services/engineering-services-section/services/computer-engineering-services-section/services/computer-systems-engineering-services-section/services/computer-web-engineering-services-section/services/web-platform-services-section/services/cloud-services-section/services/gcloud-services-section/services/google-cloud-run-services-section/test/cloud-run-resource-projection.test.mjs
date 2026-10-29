import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { deployCloudRunService } from "@red-cup-engineering/gcloud-cloud-run-actuator-service";
import {
  formCloudRunServiceCutoverRequest,
  formCloudRunServiceDeploymentRequest,
  formCloudRunServiceDiscoveryRequest,
  loadCloudRunResourceInstance,
  NOTEBOOKLM_CLOUD_RUN_RESOURCE,
  projectNodeRuntimeContainerImageConstructionInput,
  projectCloudRunServiceObservation,
  projectStagedCloudRunServiceObservation,
} from "../src/cloud-run-resource-projection.mjs";

const target = Object.freeze({ project: "five-six-one-group-dev", region: "us-central1", service: "notebooklm-inference-team" });
const originEnvironmentBindings = Object.freeze(["ACTIVITYPUB_ORIGIN", "NOTEBOOKLM_ARTIFACT_BASE_URL"]);
function canonical(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}
const identify = (body) => `ni:///sha-256;${createHash("sha256").update(canonical(body)).digest("base64url")}`;
const releaseEvidence = Object.freeze({
  providerCatalog: { type: "NodeRuntimeProviderCatalog", version: 1 },
  runtimeReleaseCatalogReceipt: { type: "NodeRuntimeReleaseCatalogReceipt", version: 1 },
  verificationObservation: { type: "NodeRuntimeReleaseCatalogVerificationObservation", version: 1 },
});
function providerRequirement() {
  return {
    type: "NotebookLmCloudRunRuntimeImageRequirement", version: 1, status: "required", effects: [],
    providerContract: { package: { name: "@red-cup-engineering/notebooklm-services-section", version: "0.3.7" }, requirementsLock: { path: "requirements.lock", sha256: "sha256:781d2674dcdd42bd95c1aad64500deaf2d961175ebc0c12489f552985166b9ec", installation: "require-hashes" } },
  };
}
function ociImageObservation(resource = loadCloudRunResourceInstance()) {
  const construction = resource.desired.imageConstruction;
  const body = {
    type: "OciImageObservation", version: 1, status: "observed", effects: [], reference: construction.ociSelection.requestedReference,
    requestedDigest: construction.ociSelection.tagIndexDigest, index: { digest: construction.ociSelection.tagIndexDigest }, manifest: { digest: construction.ociSelection.selectedManifestDigest },
    config: { digest: construction.ociSelection.configDigest, os: "linux", architecture: "amd64" }, platform: { os: "linux", architecture: "amd64" },
    node: { status: "observed", version: "24.19.0" }, debian: { status: "observed", suite: "bookworm" },
    finalRootfs: { occupied: { union: { uids: [0, 1000], gids: [0, 1000] } } }, unresolved: [], readAuthority: { id: `ni:///sha-256;${"R".repeat(43)}` },
  };
  return { id: identify(body), ...body };
}

function closedResource() {
  const value = structuredClone(loadCloudRunResourceInstance());
  value.desired.image = { ...value.desired.image, status: "declared", value: "us-central1-docker.pkg.dev/five-six-one-group-dev/runtime/notebooklm-inference-team@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" };
  value.desired.imageConstruction = { ...value.desired.imageConstruction, status: "declared", providerRequirement: providerRequirement(), releaseEvidence: structuredClone(releaseEvidence), ociImageObservation: ociImageObservation(value), unresolved: [] };
  value.desired.environment = { ...value.desired.environment, status: "declared", unresolved: [], values: { ...value.desired.environment.values, WITNESS_JOURNAL_RDF_AGENT: "https://witness-journal.example.test" } };
  value.desired.secretBindings = { ...value.desired.secretBindings, status: "declared", unresolved: [], values: { ...value.desired.secretBindings.values, "/secrets/activitypub/inbox-bearer-token": "notebooklm-inbox-token:1", "/secrets/agent-card/signing-key": "notebooklm-agent-card:1", "/secrets/notebooklm/artifact-capability-key": "notebooklm-artifact-capability:1" } };
  return value;
}

function stagedService(resource) {
  const desired = resource.desired;
  const revision = "notebooklm-inference-team-00021-abc";
  const tagUrl = "https://candidate---notebooklm-inference-team.example.test";
  const secretEntries = Object.entries(desired.secretBindings.values);
  const secretEnvironment = secretEntries.filter(([name]) => /^[A-Z][A-Z0-9_]*$/u.test(name)).map(([name, reference]) => {
    const [secret, key] = reference.split(":"); return { name, valueFrom: { secretKeyRef: { name: secret, key } } };
  });
  const secretFiles = secretEntries.filter(([name]) => name.startsWith("/"));
  const volumeMounts = secretFiles.map(([mountPath], index) => ({ name: `secret-${index}`, mountPath }));
  const volumes = secretFiles.map(([mountPath, reference], index) => {
    const [secretName, key] = reference.split(":"); return { name: `secret-${index}`, secret: { secretName, items: [{ key, path: mountPath.split("/").at(-1) }] } };
  });
  return {
    metadata: { name: target.service, generation: 21, annotations: { "run.googleapis.com/ingress": desired.runtime.ingress } },
    spec: { template: { metadata: { annotations: {
      "autoscaling.knative.dev/maxScale": String(desired.runtime.maxInstances), "autoscaling.knative.dev/minScale": String(desired.runtime.minInstances),
      "run.googleapis.com/execution-environment": desired.runtime.executionEnvironment, "run.googleapis.com/cpu-throttling": String(desired.runtime.cpuThrottling),
      "run.googleapis.com/startup-cpu-boost": String(desired.runtime.startupCpuBoost),
    } }, spec: { serviceAccountName: desired.runtime.serviceAccount, containerConcurrency: desired.runtime.concurrency, timeoutSeconds: desired.runtime.timeoutSeconds,
      containers: [{ image: desired.image.value, resources: { limits: { cpu: desired.runtime.cpu, memory: desired.runtime.memory } }, ports: [{ containerPort: desired.runtime.containerPort }], startupProbe: desired.runtime.startupProbe, readinessProbe: desired.runtime.readinessProbe, livenessProbe: desired.runtime.livenessProbe, env: [...Object.entries(desired.environment.values).map(([name, value]) => ({ name, value })), ...secretEnvironment], volumeMounts }], volumes } } },
    status: { url: desired.domain.canonicalOrigin, latestReadyRevisionName: revision, traffic: [{ revisionName: revision, tag: desired.staging.revisionTag, percent: 0, url: tagUrl }] },
  };
}

test("the initial resource separates checked-in observation evidence from open desired state", () => {
  const resource = loadCloudRunResourceInstance();
  assert.equal(resource.resource, NOTEBOOKLM_CLOUD_RUN_RESOURCE);
  assert.equal(resource.observed.evidence.kind, "provider-authored-checked-in-declaration");
  assert.equal(resource.observed.revision.name, "notebooklm-inference-team-00020-qsz");
  assert.equal(resource.desired.image.status, "unresolved");
  assert.equal(resource.desired.imageConstruction.status, "partial");
  assert.equal(resource.desired.invocationAdmission.status, "declared");
  assert.deepEqual(resource.desired.runtime.networkAttachment, { mode: "none" });
  assert.equal(resource.desired.runtime.status, "declared");
  assert.equal(Object.hasOwn(resource.desired.environment.values, "BASE_URL"), false);
  assert.equal(Object.hasOwn(resource.desired.environment.values, "CLOUDFLARE_R2_ACCOUNT_ID"), false);
  assert.equal(resource.desired.environment.values.NOTEBOOKLM_PYTHON, "/app/notebooklm/.venv/bin/python3");
  assert.deepEqual({ minInstances: resource.desired.runtime.minInstances, executionEnvironment: resource.desired.runtime.executionEnvironment, cpuThrottling: resource.desired.runtime.cpuThrottling, startupCpuBoost: resource.desired.runtime.startupCpuBoost }, { minInstances: 1, executionEnvironment: "gen2", cpuThrottling: false, startupCpuBoost: true });
  assert.equal(resource.desired.runtime.startupProbe.httpGet.path, "/healthz");
  assert.equal(resource.desired.traffic.status, "explicit-gate-required");
});

test("discovery projects the exact generic actuator request without a cloud effect", () => {
  assert.deepEqual(formCloudRunServiceDiscoveryRequest(loadCloudRunResourceInstance()), { operation: "discover-cloud-run-service", ...target });
});

test("an actuator discovery receipt becomes a current observation, not desired state", () => {
  const origin = "https://notebooklm-inference-team-a2d7mjqbfa-uc.a.run.app";
  const observed = { status: { latestReadyRevisionName: "notebooklm-inference-team-00020-qsz" } };
  const receipt = { receipt: { actor: "urn:ame:gcloud-cloud-run-actuator-service", published: "2026-08-16T12:00:00.000Z", object: { name: "discover-cloud-run-service", content: { service: target, url: origin, generation: "20", observed } } } };
  const projection = projectCloudRunServiceObservation(loadCloudRunResourceInstance(), receipt);
  assert.equal(projection.generation, 20);
  assert.equal(projection.declaredComparison.urlMatches, true);
  assert.equal(projection.declaredComparison.revisionMatches, true);
  assert.deepEqual(projection.providerState, observed);
});

test("a legitimate not-yet-ready actuator observation remains evidence instead of becoming desired state", () => {
  const receipt = { receipt: { actor: "urn:ame:gcloud-cloud-run-actuator-service", published: "2026-08-16T12:00:00.000Z", object: { name: "discover-cloud-run-service", content: { service: target, url: null, generation: null, observed: { status: {} } } } } };
  const projection = projectCloudRunServiceObservation(loadCloudRunResourceInstance(), receipt);
  assert.equal(projection.url, null);
  assert.equal(projection.generation, null);
  assert.equal(projection.revision, null);
  assert.deepEqual(projection.declaredComparison, { urlMatches: false, revisionMatches: false });
});

test("the checked-in open desired projection refuses rather than inventing deployment facts", () => {
  assert.deepEqual(formCloudRunServiceDeploymentRequest(loadCloudRunResourceInstance()), {
    type: "GoogleCloudRunResourceProjectionRefusal",
    operation: "deploy-cloud-run-service",
    code: "desired-projection-open",
    missing: ["environment", "image", "imageConstruction", "secretBindings"],
    detail: "required deployment fields are not yet filled in",
  });
});

test("construction input remains a refusal until all three foreign evidence owners speak", () => {
  assert.deepEqual(projectNodeRuntimeContainerImageConstructionInput(loadCloudRunResourceInstance()), {
    type: "GoogleCloudRunResourceProjectionRefusal", operation: "project-node-runtime-container-image-construction-input", code: "image-construction-evidence-open",
    missing: ["ociImageObservation", "providerReleaseEvidence", "providerRequirement"],
    detail: "image construction requires provider release evidence and an OCI image observation",
  });
});

test("construction input projects selections without importing or impersonating the constructor", () => {
  const resource = loadCloudRunResourceInstance();
  const projection = projectNodeRuntimeContainerImageConstructionInput(resource, { providerRequirement: providerRequirement(), releaseEvidence, ociImageObservation: ociImageObservation(resource) });
  assert.equal(projection.type, "GoogleCloudRunNodeRuntimeImageConstructionInputProjection");
  assert.equal(projection.authoritySelections.node.version, "24.19.0");
  assert.equal(projection.ociImageObservation.manifest.digest, resource.desired.imageConstruction.ociSelection.selectedManifestDigest);
  assert.equal(resource.desired.imageConstruction.ociSelection.requestedReference, `registry-1.docker.io/library/node@${resource.desired.imageConstruction.ociSelection.tagIndexDigest}`);
  assert.equal(projection.providerRequirement.providerContract.package.version, "0.3.7");
});

test("construction projection rejects invented identities and machine schema rejects fake networking", () => {
  const resource = loadCloudRunResourceInstance();
  const base = ociImageObservation(resource); base.id = `ni:///sha-256;${"X".repeat(43)}`;
  assert.throws(() => projectNodeRuntimeContainerImageConstructionInput(resource, { providerRequirement: providerRequirement(), releaseEvidence, ociImageObservation: base }), /content identity/u);
  const invalid = structuredClone(resource); invalid.desired.runtime.networkAttachment = { mode: "none", network: "default" };
  assert.throws(() => formCloudRunServiceDiscoveryRequest(invalid), /networkAttachment/u);
});

test("a closed machine-owned projection has the actuator's exact staged-deployment shape", () => {
  const resource = closedResource();
  const request = formCloudRunServiceDeploymentRequest(resource);
  assert.equal(request.operation, "deploy-cloud-run-service");
  assert.deepEqual({ project: request.project, region: request.region, service: request.service }, target);
  assert.match(request.image, /@sha256:a{64}$/u);
  assert.equal(request.revisionTag, "candidate");
  assert.equal(request.invocationAdmission.closed, true);
  assert.equal(request.environment.ACTIVITYPUB_ORIGIN, resource.desired.domain.canonicalOrigin);
  assert.equal(request.maxInstances, 1);
  assert.equal(request.timeoutSeconds, 900);
  assert.equal(request.concurrency, 4);
  assert.equal(request.minInstances, 1);
  assert.equal(request.executionEnvironment, "gen2");
  assert.equal(request.cpuThrottling, false);
  assert.equal(request.startupCpuBoost, true);
  assert.equal(request.containerPort, 8080);
  assert.equal(request.startupProbe.httpGet.path, "/healthz");
  assert.equal(request.readinessProbe.httpGet.path, "/healthz");
  assert.equal(request.livenessProbe.httpGet.path, "/healthz");
  assert.equal(request.ingress, "all");
  assert.equal(request.deployHealthCheck, true);
  assert.equal(Object.hasOwn(request, "network"), false);
  assert.equal(Object.hasOwn(request, "subnetwork"), false);
  assert.equal(Object.hasOwn(request, "vpcEgress"), false);
  assert.equal(Object.hasOwn(request, "customer"), false);
  assert.equal(Object.hasOwn(request, "settlementAccount"), false);
  assert.equal(Object.hasOwn(request, "dataRoot"), false);
});

test("an admitted tagged no-traffic stage projects one exact observable machine", async () => {
  const resource = closedResource();
  const request = formCloudRunServiceDeploymentRequest(resource);
  const envelope = await deployCloudRunService(request, { gcloud: async () => JSON.stringify(stagedService(resource)) });
  const observed = projectStagedCloudRunServiceObservation(resource, envelope);
  assert.equal(observed.type, "GoogleCloudRunServiceObservation");
  assert.equal(observed.phase, "staged-no-traffic");
  assert.equal(observed.revision, "notebooklm-inference-team-00021-abc");
  assert.equal(observed.url, "https://candidate---notebooklm-inference-team.example.test");
  assert.equal(observed.image, resource.desired.image.value);
  assert.equal(observed.generation, 21);
  assert.equal(observed.traffic, 0);
  assert.match(observed.stageReceipt, /^ni:\/\/\/sha-256;/u);
});

test("cutover remains a separate explicit traffic gate", () => {
  const resource = closedResource();
  const refused = formCloudRunServiceCutoverRequest(resource, originEnvironmentBindings);
  assert.equal(refused.code, "cutover-gate-open");
  assert.deepEqual(refused.missing, ["revision", "traffic"]);
  resource.desired.revision = { ...resource.desired.revision, status: "declared", name: "notebooklm-inference-team-00021-abc" };
  resource.desired.traffic = { ...resource.desired.traffic, status: "admitted", revision: resource.desired.revision.name };
  assert.deepEqual(formCloudRunServiceCutoverRequest(resource, originEnvironmentBindings), { operation: "cutover-cloud-run-service", ...target, revision: "notebooklm-inference-team-00021-abc", canonicalOrigin: "https://notebooklm-inference-team-a2d7mjqbfa-uc.a.run.app", originEnvironmentBindings: ["ACTIVITYPUB_ORIGIN", "NOTEBOOKLM_ARTIFACT_BASE_URL"] });
});

test("cutover refuses without explicit origin environment bindings", () => {
  const resource = closedResource();
  resource.desired.revision = { ...resource.desired.revision, status: "declared", name: "notebooklm-inference-team-00021-abc" };
  resource.desired.traffic = { ...resource.desired.traffic, status: "admitted", revision: resource.desired.revision.name };
  assert.deepEqual(formCloudRunServiceCutoverRequest(resource).missing, ["originEnvironmentBindings"]);
  assert.deepEqual(formCloudRunServiceCutoverRequest(resource, ["not-shouty"]).missing, ["originEnvironmentBindings"]);
  assert.deepEqual(formCloudRunServiceCutoverRequest(resource, ["DUPLICATE", "DUPLICATE"]).missing, ["originEnvironmentBindings"]);
});

test("an explicit direct VPC attachment remains representable and projects all three flags", () => {
  const resource = closedResource();
  resource.desired.runtime.networkAttachment = { mode: "direct-vpc", network: "runtime-net", subnetwork: "runtime-subnet", vpcEgress: "private-ranges-only" };
  const request = formCloudRunServiceDeploymentRequest(resource);
  assert.deepEqual({ network: request.network, subnetwork: request.subnetwork, vpcEgress: request.vpcEgress }, { network: "runtime-net", subnetwork: "runtime-subnet", vpcEgress: "private-ranges-only" });
});

test("the resource projection contains no YouTube or customer-owned runtime state", () => {
  const bytes = JSON.stringify(loadCloudRunResourceInstance());
  for (const forbidden of ["youtube", "settlementAccount", "notebookId", "PERSISTENT_NOTEBOOK_DATA_ROOT", "customerArtifactBaseUrl"]) assert.equal(bytes.includes(forbidden), false);
});
