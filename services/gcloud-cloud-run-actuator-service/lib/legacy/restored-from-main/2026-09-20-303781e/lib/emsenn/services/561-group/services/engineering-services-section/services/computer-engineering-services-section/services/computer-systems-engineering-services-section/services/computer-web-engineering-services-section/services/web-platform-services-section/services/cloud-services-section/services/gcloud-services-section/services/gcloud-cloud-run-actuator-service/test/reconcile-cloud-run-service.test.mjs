import assert from "node:assert/strict";
import test from "node:test";
import { cutoverCloudRunService, deployCloudRunService, reconcileCloudRunService } from "../src/gcloud-cloud-run-actuator.mjs";

const input = Object.freeze({
  project: "five-six-one-group-dev", region: "us-central1", service: "wuxian-gui", domain: "gui.561.group",
  image: "us-central1-docker.pkg.dev/five-six-one-group-dev/cloud-run-source-deploy/wuxian-gui@sha256:34c7581c8b8cb31032b317a6378bebb7752067e3edcbc49e490f0032a69ec895",
  invocationAdmission: Object.freeze({ type: "CloudRunInvocationAdmission", mode: "public", closed: true }),
  environment: { IAP_OPERATOR_EMAIL: "morgan.sennhauser@gmail.com", MUD_PUBLIC_PROJECTION: "true", MUD_CHAIN_READER_ORIGIN: "http://10.128.0.2:8562" },
  concurrency: 4, cpu: "2", memory: "1Gi", serviceAccount: "1019481907460-compute@developer.gserviceaccount.com",
  network: "default", subnetwork: "default", vpcEgress: "private-ranges-only", timeoutSeconds: 300, maxInstances: 20,
});

function service({ image = input.image } = {}) {
  return JSON.stringify({ spec: { template: { metadata: { annotations: {
    "autoscaling.knative.dev/maxScale": "20", "run.googleapis.com/vpc-access-egress": "private-ranges-only",
    "run.googleapis.com/network-interfaces": "[{\"network\":\"default\",\"subnetwork\":\"default\"}]",
  } }, spec: { containerConcurrency: 4, serviceAccountName: input.serviceAccount, timeoutSeconds: 300, containers: [{
    image, resources: { limits: { cpu: "2", memory: "1Gi" } },
    env: Object.entries(input.environment).map(([name, value]) => ({ name, value })),
  }] } } } });
}
const publicPolicy = JSON.stringify({ bindings: [{ role: "roles/run.invoker", members: ["allUsers"] }] });
const mapped = JSON.stringify({ spec: { routeName: "wuxian-gui" }, status: { mappedRouteName: "wuxian-gui" } });

test("a fully matching public service and mapping produce no deployment or creation", async () => {
  const calls = [];
  const result = await reconcileCloudRunService(input, { gcloud: async (args) => {
    calls.push(args);
    if (args.join(" ").includes("services describe")) return service();
    if (args.join(" ").includes("get-iam-policy")) return publicPolicy;
    return mapped;
  } });
  assert.equal(calls.some((args) => args.join(" ").includes("run deploy")), false);
  assert.equal(calls.some((args) => args.includes("create")), false);
  assert.equal(calls.some((args) => args.includes("add-iam-policy-binding")), false);
  assert.equal(result.receipt.object.content.serviceAction, "unchanged");
  assert.equal(result.receipt.object.content.domainMapping.action, "unchanged");
});

test("drift deploys required configuration, grants public invocation, and creates only a missing mapping", async () => {
  const calls = [];
  let describes = 0;
  const result = await reconcileCloudRunService(input, { gcloud: async (args) => {
    calls.push(args);
    const command = args.join(" ");
    if (command.includes("services describe")) return service({ image: "example.invalid/old@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    if (command.includes("get-iam-policy")) return JSON.stringify({ bindings: [] });
    if (command.includes("run deploy")) return JSON.stringify({ status: { url: "https://wuxian-gui.example", latestReadyRevisionName: "wuxian-gui-00007" } });
    if (args.includes("describe") && describes++ === 0) throw new Error("NOT_FOUND");
    return mapped;
  } });
  const deploy = calls.find((args) => args.join(" ").includes("run deploy"));
  assert.ok(deploy);
  for (const required of ["--update-env-vars", "--concurrency", "--cpu", "--memory", "--service-account", "--network", "--subnet", "--vpc-egress", "--timeout", "--max-instances"]) assert.equal(deploy.includes(required), true);
  assert.equal(deploy.some((argument) => argument.includes("allow-unauthenticated")), false);
  assert.equal(calls.some((args) => args.includes("add-iam-policy-binding") && args.includes("allUsers")), true);
  assert.equal(calls.some((args) => args.includes("create") && args.includes("--service") && args.includes("wuxian-gui")), true);
  assert.equal(result.receipt.object.content.serviceAction, "deployed");
  assert.equal(result.receipt.object.content.invocationAdmission.action, "converged");
});

test("a mapping belonging to another service refuses", async () => {
  await assert.rejects(() => reconcileCloudRunService(input, { gcloud: async (args) => {
    const command = args.join(" ");
    if (command.includes("services describe")) return service();
    if (command.includes("get-iam-policy")) return publicPolicy;
    return JSON.stringify({ spec: { routeName: "other-service" } });
  } }), /other-service/);
});

test("deployment only stages a digest-pinned image with no traffic", async () => {
  const calls = [];
  await deployCloudRunService({ ...input }, { gcloud: async (args) => {
    calls.push(args);
    return JSON.stringify({ status: { latestReadyRevisionName: "wuxian-gui-00008" } });
  } });
  assert.equal(calls[0].includes("--no-traffic"), true);
  assert.equal(calls[0].some((arg) => arg === "--to-latest" || arg.startsWith("--to-revisions")), false);
  await assert.rejects(() => deployCloudRunService({ ...input, image: "example.com/wuxian-gui:latest" }, { gcloud: async () => "{}" }), /pinned by sha256 digest/);
});

test("staged revision tags obey the provider's combined service and tag route limit", async () => {
  const calls = [];
  const service = `a${"a".repeat(37)}`;
  await deployCloudRunService({ ...input, service, revisionTag: "s-abcdef" }, { gcloud: async (args) => {
    calls.push(args);
    return JSON.stringify({ status: { latestReadyRevisionName: `${service}-00008` } });
  } });
  assert.equal(calls[0].includes("--tag"), true);
  await assert.rejects(() => deployCloudRunService({ ...input, service: `a${"a".repeat(38)}`, revisionTag: "s-abcdef" }, { gcloud: async () => "{}" }), /addressable route limit/);
});

test("staging admits only bounded Secret Manager environment and mount bindings", async () => {
  const calls = [];
  await deployCloudRunService({ ...input, secretBindings: {
    GITHUB_SERVICES_TOKEN: "github-software-induction-token:latest",
    "/secrets/activitypub/keys.json": "github-software-induction-activitypub-keys:3",
  } }, { gcloud: async (args) => { calls.push(args); return "{}"; } });
  const bindings = calls[0][calls[0].indexOf("--update-secrets") + 1];
  assert.match(bindings, /GITHUB_SERVICES_TOKEN=github-software-induction-token:latest/u);
  assert.match(bindings, /\/secrets\/activitypub\/keys\.json=github-software-induction-activitypub-keys:3/u);
  await assert.rejects(() => deployCloudRunService({ ...input, secretBindings: { "/tmp/key": "secret:latest" } }, { gcloud: async () => "{}" }), /Secret Manager bindings/);
});

test("cutover is explicit after the named revision establishes its canonical origin", async () => {
  const calls = [];
  const origin = "https://github-software-induction.example";
  await cutoverCloudRunService({ project: input.project, region: input.region, service: input.service, revision: "wuxian-gui-00008", canonicalOrigin: origin, originEnvironmentBindings: ["ACTIVITYPUB_ORIGIN", "NOTEBOOKLM_ARTIFACT_BASE_URL"] }, { gcloud: async (args) => {
    calls.push(args);
    if (args.join(" ").includes("revisions describe")) return JSON.stringify({ metadata: { name: "wuxian-gui-00008", labels: { "serving.knative.dev/service": input.service } }, spec: { containers: [{ env: [{ name: "ACTIVITYPUB_ORIGIN", value: origin }, { name: "NOTEBOOKLM_ARTIFACT_BASE_URL", value: origin }] }] } });
    return "{}";
  } });
  const cutover = calls[1];
  assert.deepEqual(cutover.slice(-4), ["--to-revisions", "wuxian-gui-00008=100", "--format=json", "--quiet"]);
});

test("cutover refuses before traffic when the canonical service origin is absent", async () => {
  const calls = [];
  await assert.rejects(() => cutoverCloudRunService({
    project: input.project, region: input.region, service: input.service, revision: "wuxian-gui-00008", canonicalOrigin: "https://github-software-induction.example", originEnvironmentBindings: ["ACTIVITYPUB_ORIGIN"],
  }, { gcloud: async (args) => { calls.push(args); return JSON.stringify({ metadata: { name: "wuxian-gui-00008", labels: { "serving.knative.dev/service": input.service } }, spec: { containers: [{ env: [] }] } }); } }), /canonical service origin/);
  assert.equal(calls.some((args) => args.includes("update-traffic")), false);
});

test("cutover requires an explicit nonempty canonical-origin environment-binding set", async () => {
  await assert.rejects(() => cutoverCloudRunService({
    project: input.project, region: input.region, service: input.service, revision: "wuxian-gui-00008", canonicalOrigin: "https://github-software-induction.example",
  }, { gcloud: async () => { throw new Error("must refuse before observation"); } }), /originEnvironmentBindings/u);
});

test("cutover refuses a revision owned by another service", async () => {
  await assert.rejects(() => cutoverCloudRunService({
    project: input.project, region: input.region, service: input.service, revision: "wuxian-gui-00008", canonicalOrigin: "https://github-software-induction.example", originEnvironmentBindings: ["ACTIVITYPUB_ORIGIN"],
  }, { gcloud: async () => JSON.stringify({ metadata: { name: "wuxian-gui-00008", labels: { "serving.knative.dev/service": "other-service" } }, spec: { containers: [{ env: [] }] } }) }), /not owned/);
});

test("cutover requires the exact serving-service ownership label", async () => {
  await assert.rejects(() => cutoverCloudRunService({
    project: input.project, region: input.region, service: input.service, revision: "wuxian-gui-00008", canonicalOrigin: "https://github-software-induction.example", originEnvironmentBindings: ["ACTIVITYPUB_ORIGIN"],
  }, { gcloud: async () => JSON.stringify({ metadata: { name: "wuxian-gui-00008", labels: {} }, spec: { containers: [{ env: [] }] } }) }), /not owned/);
});
