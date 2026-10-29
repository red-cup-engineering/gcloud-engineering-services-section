import assert from "node:assert/strict";
import test from "node:test";

import {
  CloudRunServiceReceiptAdmissionError,
  admitCloudRunServiceCutoverReceipt,
  admitCloudRunServiceDiscoveryReceipt,
  admitCloudRunServiceStageReceipt,
  cutoverCloudRunService,
  deployCloudRunService,
  discoverCloudRunService,
  projectCloudRunServiceStageActivityRequest,
} from "../src/gcloud-cloud-run-actuator.mjs";

const target = Object.freeze({ project: "five-six-one-group-dev", region: "us-central1", service: "notebooklm-inference-team" });
const revision = "notebooklm-inference-team-00021";
const origin = "https://notebooklm-inference-team-a2d7mjqbfa-uc.a.run.app";
const image = `us-central1-docker.pkg.dev/five-six-one-group-dev/youtube/notebooklm@sha256:${"a".repeat(64)}`;
const invocationAdmission = Object.freeze({ type: "CloudRunInvocationAdmission", mode: "public", closed: true });
const discoveryRequest = Object.freeze({ operation: "discover-cloud-run-service", ...target });
const startupProbe = Object.freeze({ httpGet: Object.freeze({ path: "/healthz", port: 8080 }), initialDelaySeconds: 0, timeoutSeconds: 1, periodSeconds: 10, failureThreshold: 3 });
const readinessProbe = Object.freeze({ httpGet: Object.freeze({ path: "/healthz", port: 8080 }), timeoutSeconds: 1, periodSeconds: 10, failureThreshold: 3, successThreshold: 1 });
const livenessProbe = Object.freeze({ httpGet: Object.freeze({ path: "/healthz", port: 8080 }), initialDelaySeconds: 0, timeoutSeconds: 1, periodSeconds: 10, failureThreshold: 3 });
const providerStartupProbe = Object.freeze({ httpGet: startupProbe.httpGet, timeoutSeconds: 1, periodSeconds: 10, failureThreshold: 3 });
const providerReadinessProbe = Object.freeze({ httpGet: readinessProbe.httpGet, timeoutSeconds: 1, periodSeconds: 10, failureThreshold: 3 });
const providerLivenessProbe = Object.freeze({ httpGet: livenessProbe.httpGet, timeoutSeconds: 1, periodSeconds: 10, failureThreshold: 3 });
const stageRequest = Object.freeze({
  operation: "deploy-cloud-run-service",
  ...target,
  image,
  invocationAdmission,
  environment: { BASE_URL: origin, ACTIVITYPUB_ORIGIN: origin },
  secretBindings: { NOTEBOOKLM_AUTH: "notebooklm-auth:latest", "/secrets/activitypub/keys.json": "activitypub-keys:3" },
  concurrency: 1,
  cpu: "1",
  memory: "1Gi",
  serviceAccount: "notebooklm-runtime@five-six-one-group-dev.iam.gserviceaccount.com",
  network: "default",
  subnetwork: "default",
  vpcEgress: "private-ranges-only",
  timeoutSeconds: 300,
  maxInstances: 1,
  minInstances: 1,
  executionEnvironment: "gen2",
  cpuThrottling: false,
  startupCpuBoost: true,
  containerPort: 8080,
  startupProbe,
  readinessProbe,
  livenessProbe,
  ingress: "all",
  deployHealthCheck: true,
  revisionTag: "staged",
});
const cutoverRequest = Object.freeze({ operation: "cutover-cloud-run-service", ...target, revision, canonicalOrigin: origin, originEnvironmentBindings: ["NOTEBOOKLM_ARTIFACT_BASE_URL", "ACTIVITYPUB_ORIGIN"] });

function serviceState({ generation = 21, traffic = [], url = origin, readyRevision = revision, deployedImage = image } = {}) {
  return {
    metadata: { name: target.service, generation, annotations: { "run.googleapis.com/ingress": "all" } },
    spec: { template: { metadata: { annotations: {
      "autoscaling.knative.dev/maxScale": "1", "run.googleapis.com/vpc-access-egress": "private-ranges-only",
      "run.googleapis.com/network-interfaces": "[{\"network\":\"default\",\"subnetwork\":\"default\"}]",
      "autoscaling.knative.dev/minScale": "1", "run.googleapis.com/execution-environment": "gen2", "run.googleapis.com/cpu-throttling": "false", "run.googleapis.com/startup-cpu-boost": "true",
    } }, spec: { serviceAccountName: stageRequest.serviceAccount, containerConcurrency: 1, timeoutSeconds: 300, containers: [{ image: deployedImage,
      resources: { limits: { cpu: "1", memory: "1Gi" } },
      ports: [{ containerPort: 8080 }], startupProbe: providerStartupProbe, readinessProbe: providerReadinessProbe, livenessProbe: providerLivenessProbe,
      env: [...Object.entries(stageRequest.environment).map(([name, value]) => ({ name, value })), { name: "NOTEBOOKLM_AUTH", valueFrom: { secretKeyRef: { name: "notebooklm-auth", key: "latest" } } }],
      volumeMounts: [{ name: "activitypub-keys", mountPath: "/secrets/activitypub/keys.json" }],
    }], volumes: [{ name: "activitypub-keys", secret: { secretName: "activitypub-keys", items: [{ key: "3", path: "keys.json" }] } }] } } },
    status: { url, latestReadyRevisionName: readyRevision, traffic },
  };
}
function copyEnvelope(value, mutate) {
  const copy = structuredClone(value);
  mutate(copy);
  copy.jsonl = `${JSON.stringify(copy.receipt)}\n`;
  return copy;
}
function assertAdmissionError(callback, code) {
  assert.throws(callback, (error) => error instanceof CloudRunServiceReceiptAdmissionError && error.code === code);
}

async function receipts() {
  const stageState = serviceState({ generation: 20, traffic: [{ revisionName: "notebooklm-inference-team-00020", percent: 100 }, { revisionName: revision, tag: "staged", url: "https://staged---notebooklm-inference-team-a2d7mjqbfa-uc.a.run.app" }] });
  const activeState = serviceState({ traffic: [{ revisionName: revision, percent: 100 }] });
  const discovery = await discoverCloudRunService(discoveryRequest, { gcloud: async () => JSON.stringify(activeState) });
  const stage = await deployCloudRunService(stageRequest, { gcloud: async () => JSON.stringify(stageState) });
  const cutover = await cutoverCloudRunService(cutoverRequest, { gcloud: async (args) => {
    if (args.join(" ").includes("revisions describe")) return JSON.stringify({ metadata: { name: revision, labels: { "serving.knative.dev/service": target.service } }, spec: { containers: [{ env: [{ name: "ACTIVITYPUB_ORIGIN", value: origin }, { name: "NOTEBOOKLM_ARTIFACT_BASE_URL", value: origin }] }] } });
    return JSON.stringify(activeState);
  } });
  return { discovery, stage, cutover };
}

test("owner admits exact discovery, no-traffic stage, and named-revision cutover receipts", async () => {
  const { discovery, stage, cutover } = await receipts();
  const discovered = admitCloudRunServiceDiscoveryReceipt(discovery, discoveryRequest);
  const staged = admitCloudRunServiceStageReceipt(stage, stageRequest);
  const activated = admitCloudRunServiceCutoverReceipt(cutover, cutoverRequest);
  assert.equal(discovered.type, "CloudRunServiceDiscoveryReceiptAdmission");
  assert.equal(staged.type, "CloudRunServiceStageReceiptAdmission");
  assert.equal(activated.type, "CloudRunServiceCutoverReceiptAdmission");
  assert.match(staged.id, /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u);
  assert.equal(staged.generation, 20);
  assert.equal(staged.traffic, 0);
  assert.equal(activated.generation, 21);
  assert.equal(activated.traffic, 100);
  assert.equal(Object.isFrozen(staged), true);
  assert.equal(Object.isFrozen(staged.receipt.object.content.deployed), true);
  assert.deepEqual(projectCloudRunServiceStageActivityRequest(stageRequest), {
    ...target, image, invocationAdmission, serviceAccount: stageRequest.serviceAccount, environment: stageRequest.environment,
    secretBindings: stageRequest.secretBindings, concurrency: 1, cpu: "1", memory: "1Gi", network: "default", subnetwork: "default",
    vpcEgress: "private-ranges-only", timeoutSeconds: 300, maxInstances: 1, minInstances: 1, executionEnvironment: "gen2", cpuThrottling: false,
    startupCpuBoost: true, containerPort: 8080, startupProbe, readinessProbe, livenessProbe, ingress: "all", deployHealthCheck: true, revisionTag: "staged",
  });
});

test("stage emits every exact gcloud 578 runtime and health flag", async () => {
  let command;
  await deployCloudRunService(stageRequest, { gcloud: async (args) => { command = args; return JSON.stringify(serviceState()); } });
  const valueAfter = (flag) => command[command.indexOf(flag) + 1];
  assert.equal(valueAfter("--min-instances"), "1");
  assert.equal(valueAfter("--execution-environment"), "gen2");
  assert.equal(command.includes("--no-cpu-throttling"), true);
  assert.equal(command.includes("--cpu-boost"), true);
  assert.equal(valueAfter("--port"), "8080");
  assert.equal(valueAfter("--startup-probe"), "initialDelaySeconds=0,timeoutSeconds=1,periodSeconds=10,failureThreshold=3,httpGet.path=/healthz,httpGet.port=8080");
  assert.equal(valueAfter("--readiness-probe"), "timeoutSeconds=1,periodSeconds=10,failureThreshold=3,successThreshold=1,httpGet.path=/healthz,httpGet.port=8080");
  assert.equal(valueAfter("--liveness-probe"), "initialDelaySeconds=0,timeoutSeconds=1,periodSeconds=10,failureThreshold=3,httpGet.path=/healthz,httpGet.port=8080");
  assert.equal(valueAfter("--ingress"), "all");
  assert.equal(command.includes("--deploy-health-check"), true);
});

test("explicit opposite booleans emit their exact gcloud negative or positive forms", async () => {
  let command;
  await deployCloudRunService({ ...target, image, invocationAdmission, cpuThrottling: true, startupCpuBoost: false, deployHealthCheck: false }, { gcloud: async (args) => { command = args; return JSON.stringify(serviceState()); } });
  assert.equal(command.includes("--cpu-throttling"), true);
  assert.equal(command.includes("--no-cpu-boost"), true);
  assert.equal(command.includes("--no-deploy-health-check"), true);
});

test("stage admission normalizes live-shaped Cloud Run v2 runtime fields", async () => {
  const v2 = {
    name: `projects/123/locations/us-central1/services/${target.service}`, generation: "20", uri: origin, latestReadyRevision: `projects/123/locations/us-central1/services/${target.service}/revisions/${revision}`,
    ingress: "INGRESS_TRAFFIC_ALL", traffic: [{ revision: `projects/123/locations/us-central1/services/${target.service}/revisions/notebooklm-inference-team-00020`, percent: 100 }],
    spec: { template: {
      scaling: { minInstanceCount: 1, maxInstanceCount: 1 }, executionEnvironment: "EXECUTION_ENVIRONMENT_GEN2", serviceAccount: stageRequest.serviceAccount,
      maxInstanceRequestConcurrency: 1, timeout: "300s", vpcAccess: { egress: "VPC_EGRESS_PRIVATE_RANGES_ONLY", networkInterfaces: [{ network: "default", subnetwork: "default" }] },
      containers: [{ image, resources: { limits: { cpu: "1", memory: "1Gi" }, cpuIdle: false, startupCpuBoost: true }, ports: [{ containerPort: 8080 }], startupProbe, readinessProbe, livenessProbe,
        env: Object.entries(stageRequest.environment).map(([name, value]) => ({ name, value })) }],
    } },
  };
  const withoutSecrets = { ...stageRequest }; delete withoutSecrets.secretBindings; delete withoutSecrets.revisionTag;
  const envelope = await deployCloudRunService(withoutSecrets, { gcloud: async () => JSON.stringify(v2) });
  assert.equal(admitCloudRunServiceStageReceipt(envelope, withoutSecrets).generation, 20);
});

test("request digest is recomputed from the exact owner projection", async () => {
  const { discovery, stage, cutover } = await receipts();
  assertAdmissionError(() => admitCloudRunServiceDiscoveryReceipt(discovery, { ...discoveryRequest, service: "another-service" }), "receipt-request-drift");
  assertAdmissionError(() => admitCloudRunServiceStageReceipt(stage, { ...stageRequest, image: image.replace(/a{64}$/u, "b".repeat(64)) }), "receipt-request-drift");
  assertAdmissionError(() => admitCloudRunServiceCutoverReceipt(cutover, { ...cutoverRequest, revision: "notebooklm-inference-team-00022" }), "receipt-request-drift");
  assertAdmissionError(() => admitCloudRunServiceStageReceipt({ ...stage, jsonl: `${stage.jsonl} ` }, stageRequest), "receipt-envelope-invalid");
});

test("operation-specific admission refuses stage/cutover shape substitution and content drift", async () => {
  const { stage, cutover } = await receipts();
  assertAdmissionError(() => admitCloudRunServiceStageReceipt(cutover, stageRequest), "receipt-envelope-invalid");
  assertAdmissionError(() => admitCloudRunServiceCutoverReceipt(stage, cutoverRequest), "receipt-envelope-invalid");
  const imageDrift = copyEnvelope(stage, (value) => { value.receipt.object.content.image = image.replace(/a{64}$/u, "c".repeat(64)); });
  assertAdmissionError(() => admitCloudRunServiceStageReceipt(imageDrift, stageRequest), "receipt-result-drift");
});

test("stage admission refuses every supplied revision-configuration drift", async () => {
  const { stage } = await receipts();
  const mutations = [
    (state) => { state.spec.template.spec.serviceAccountName = "other@five-six-one-group-dev.iam.gserviceaccount.com"; },
    (state) => { state.spec.template.spec.containerConcurrency = 2; },
    (state) => { state.spec.template.spec.timeoutSeconds = 301; },
    (state) => { state.spec.template.spec.containers[0].resources.limits.cpu = "2"; },
    (state) => { state.spec.template.spec.containers[0].resources.limits.memory = "2Gi"; },
    (state) => { state.spec.template.spec.containers[0].env.find(({ name }) => name === "BASE_URL").value = "https://drift.example"; },
    (state) => { state.spec.template.spec.containers[0].env.find(({ name }) => name === "NOTEBOOKLM_AUTH").valueFrom.secretKeyRef.name = "other-secret"; },
    (state) => { state.spec.template.spec.volumes[0].secret.items[0].key = "4"; },
    (state) => { state.spec.template.metadata.annotations["autoscaling.knative.dev/maxScale"] = "2"; },
    (state) => { state.spec.template.metadata.annotations["run.googleapis.com/vpc-access-egress"] = "all-traffic"; },
    (state) => { state.spec.template.metadata.annotations["run.googleapis.com/network-interfaces"] = "[{\"network\":\"other\",\"subnetwork\":\"default\"}]"; },
    (state) => { state.spec.template.metadata.annotations["autoscaling.knative.dev/minScale"] = "0"; },
    (state) => { state.spec.template.metadata.annotations["run.googleapis.com/execution-environment"] = "gen1"; },
    (state) => { state.spec.template.metadata.annotations["run.googleapis.com/cpu-throttling"] = "true"; },
    (state) => { state.spec.template.metadata.annotations["run.googleapis.com/startup-cpu-boost"] = "false"; },
    (state) => { state.spec.template.spec.containers[0].ports[0].containerPort = 9090; },
    (state) => { state.spec.template.spec.containers[0].startupProbe.httpGet.path = "/wrong"; },
    (state) => { state.spec.template.spec.containers[0].readinessProbe.successThreshold = 2; },
    (state) => { state.spec.template.spec.containers[0].livenessProbe.failureThreshold = 4; },
    (state) => { state.metadata.annotations["run.googleapis.com/ingress"] = "internal"; },
  ];
  for (const mutate of mutations) {
    const drift = copyEnvelope(stage, (value) => mutate(value.receipt.object.content.deployed));
    assertAdmissionError(() => admitCloudRunServiceStageReceipt(drift, stageRequest), "receipt-result-drift");
  }
});

test("omitted stage configuration stays absent from the preimage and does not claim defaults", async () => {
  const request = { ...target, image, invocationAdmission };
  let command;
  const stage = await deployCloudRunService(request, { gcloud: async (args) => { command = args; return JSON.stringify(serviceState()); } });
  assert.deepEqual(projectCloudRunServiceStageActivityRequest(request), request);
  for (const flag of ["--min-instances", "--execution-environment", "--cpu-throttling", "--no-cpu-throttling", "--cpu-boost", "--no-cpu-boost", "--port", "--startup-probe", "--readiness-probe", "--liveness-probe", "--ingress", "--deploy-health-check", "--no-deploy-health-check"]) assert.equal(command.includes(flag), false);
  const admitted = admitCloudRunServiceStageReceipt(stage, request);
  assert.deepEqual(admitted.configuration, {});
});

test("probe and boolean input is closed before gcloud", async () => {
  await assert.rejects(() => deployCloudRunService({ ...stageRequest, startupProbe: { ...startupProbe, httpGet: { path: "/healthz,evil=1", port: 8080 } } }, { gcloud: async () => { throw new Error("must not run"); } }), /probe path/u);
  await assert.rejects(() => deployCloudRunService({ ...stageRequest, cpuThrottling: "false" }, { gcloud: async () => { throw new Error("must not run"); } }), /must be boolean/u);
});

test("generation, traffic, and origin claims must agree with exact provider result state", async () => {
  const { discovery, stage, cutover } = await receipts();
  const generationDrift = copyEnvelope(discovery, (value) => { value.receipt.object.content.generation = 22; });
  assertAdmissionError(() => admitCloudRunServiceDiscoveryReceipt(generationDrift, discoveryRequest), "receipt-result-drift");
  const invalidGeneration = copyEnvelope(stage, (value) => { value.receipt.object.content.deployed.metadata.generation = 0; });
  assertAdmissionError(() => admitCloudRunServiceStageReceipt(invalidGeneration, stageRequest), "receipt-result-invalid");
  const stageTraffic = copyEnvelope(stage, (value) => { value.receipt.object.content.deployed.status.traffic[1].percent = 1; });
  assertAdmissionError(() => admitCloudRunServiceStageReceipt(stageTraffic, stageRequest), "receipt-result-invalid");
  const cutoverTraffic = copyEnvelope(cutover, (value) => { value.receipt.object.content.activated.status.traffic[0].percent = 99; });
  assertAdmissionError(() => admitCloudRunServiceCutoverReceipt(cutoverTraffic, cutoverRequest), "receipt-result-drift");
  const malformedOrigin = copyEnvelope(discovery, (value) => { value.receipt.object.content.observed.status.url = "http://insecure.example"; value.receipt.object.content.url = "http://insecure.example"; });
  assertAdmissionError(() => admitCloudRunServiceDiscoveryReceipt(malformedOrigin, discoveryRequest), "receipt-result-invalid");
  const originDrift = copyEnvelope(cutover, (value) => { value.receipt.object.content.url = "https://other.example"; });
  assertAdmissionError(() => admitCloudRunServiceCutoverReceipt(originDrift, cutoverRequest), "receipt-result-drift");
  const bindingDrift = copyEnvelope(cutover, (value) => { value.receipt.object.content.describedRevision.spec.containers[0].env.find(({ name }) => name === "NOTEBOOKLM_ARTIFACT_BASE_URL").value = "https://other.example"; });
  assertAdmissionError(() => admitCloudRunServiceCutoverReceipt(bindingDrift, cutoverRequest), "receipt-result-drift");
});
