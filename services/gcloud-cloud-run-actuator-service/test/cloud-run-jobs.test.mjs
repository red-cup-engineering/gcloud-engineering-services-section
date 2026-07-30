import assert from "node:assert/strict";
import test from "node:test";
import { discoverCloudRunJob, executeCloudRunJob, reconcileCloudRunJob } from "../src/gcloud-cloud-run-actuator.mjs";

const input = {
  project: "five-six-one-group-dev", region: "us-central1", job: "provision-enterprise-account",
  image: "us-central1-docker.pkg.dev/five-six-one-group-dev/jobs/provision@sha256:34c7581c8b8cb31032b317a6378bebb7752067e3edcbc49e490f0032a69ec895",
  environment: { RPC_URL: "http://10.128.0.2:8563" }, secretBindings: { KMS_AUDIENCE: "kms-audience:latest" },
  cpu: "2", memory: "1Gi", serviceAccount: "1019481907460-compute@developer.gserviceaccount.com", network: "default", subnetwork: "default", vpcEgress: "private-ranges-only", timeoutSeconds: 600, tasks: 1, parallelism: 1, maxRetries: 2,
};
test("reconciles a digest-pinned bounded job and executes only declared overrides", async () => {
  const calls = [];
  const result = await reconcileCloudRunJob(input, { gcloud: async (args) => { calls.push(args); if (args.includes("describe")) throw new Error("NOT_FOUND"); return JSON.stringify({ metadata: { name: input.job } }); } });
  const deploy = calls.at(-1);
  for (const flag of ["--image", "--service-account", "--network", "--subnet", "--cpu", "--memory", "--task-timeout", "--tasks", "--parallelism", "--max-retries", "--set-env-vars", "--set-secrets"]) assert.equal(deploy.includes(flag), true);
  assert.equal(result.receipt.object.content.action, "deployed");
  const execution = await executeCloudRunJob({ project: input.project, region: input.region, job: input.job, environmentOverrides: { URN: "urn:ame:customer" } }, { gcloud: async (args) => { calls.push(args); return JSON.stringify({ metadata: { name: "provision-enterprise-account-x" } }); } });
  assert.equal(calls.at(-1).includes("--update-env-vars"), true);
  assert.equal(execution.receipt.object.name, "execute-cloud-run-job");
});
test("discovery emits an ActivityStreams receipt and digest pins are mandatory", async () => {
  const result = await discoverCloudRunJob(input, { gcloud: async () => JSON.stringify({ metadata: { name: input.job } }) });
  assert.equal(result.receipt.type, "Create");
  await assert.rejects(() => reconcileCloudRunJob({ ...input, image: "example.invalid/job:latest" }, { gcloud: async () => "{}" }), /pinned by sha256 digest/);
});
