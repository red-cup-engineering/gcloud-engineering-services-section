import assert from "node:assert/strict";
import test from "node:test";
import packageMetadata from "../package.json" with { type: "json" };
import agentCard from "../content/agent-card/agent-card.template.json" with { type: "json" };
import capabilityCell from "../content/capcell/specification.json" with { type: "json" };
import {
  actuate,
  controlPlaneDescriptor,
  deployCloudRunService,
  reconcileCloudRunInvocationAdmission,
} from "../src/gcloud-cloud-run-actuator.mjs";

const target = Object.freeze({
  project: "five-six-one-group-dev",
  region: "us-central1",
  service: "wuxian-gui",
});
const publicAdmission = Object.freeze({ type: "CloudRunInvocationAdmission", mode: "public", closed: true });

test("public admission adds allUsers without removing other bindings", async () => {
  const calls = [];
  const result = await reconcileCloudRunInvocationAdmission({ ...target, invocationAdmission: publicAdmission }, { gcloud: async (args) => {
    calls.push(args);
    if (args.includes("get-iam-policy")) return JSON.stringify({ bindings: [
      { role: "roles/run.invoker", members: ["user:existing@example.com"] },
      { role: "roles/viewer", members: ["user:auditor@example.com"] },
    ] });
    return "{}";
  } });
  assert.equal(calls.some((args) => args.includes("add-iam-policy-binding") && args.includes("allUsers")), true);
  assert.equal(calls.some((args) => args.includes("remove-iam-policy-binding") || args.includes("set-iam-policy")), false);
  assert.equal(result.receipt.object.content.action, "converged");
});

test("named principals remove invokers only with explicit complete ownership", async () => {
  const calls = [];
  const admission = { type: "CloudRunInvocationAdmission", mode: "named-principals", closed: true, principals: ["user:desired@example.com"], exclusive: true, completeOwnership: true };
  const policy = { bindings: [
    { role: "roles/run.invoker", members: ["user:desired@example.com", "user:old@example.com", "allUsers"] },
    { role: "roles/run.invoker", members: ["user:conditional@example.com"], condition: { title: "preserve" } },
  ] };
  const result = await reconcileCloudRunInvocationAdmission({ ...target, invocationAdmission: admission }, { gcloud: async (args) => {
    calls.push(args);
    return args.includes("get-iam-policy") ? JSON.stringify(policy) : "{}";
  } });
  const removed = calls.filter((args) => args.includes("remove-iam-policy-binding")).map((args) => args[args.indexOf("--member") + 1]).sort();
  assert.deepEqual(removed, ["allUsers", "user:old@example.com"]);
  assert.equal(calls.some((args) => args.includes("user:conditional@example.com")), false);
  assert.deepEqual(result.receipt.object.content.removed, removed);
});

test("legacy, missing, IAP, and unproven admission return typed refusals without calls", async () => {
  for (const candidate of [
    { allowUnauthenticated: true },
    {},
    { invocationAdmission: { type: "CloudRunInvocationAdmission", mode: "iap", closed: true } },
    { invocationAdmission: { type: "CloudRunInvocationAdmission", mode: "named-principals", closed: true, principals: ["user:desired@example.com"], exclusive: true } },
  ]) {
    const calls = [];
    const result = await reconcileCloudRunInvocationAdmission({ ...target, ...candidate }, { gcloud: async (args) => { calls.push(args); return "{}"; } });
    assert.equal(result.type, "CloudRunInvocationAdmissionRefusal");
    assert.equal(calls.length, 0);
  }
});

test("deploy refuses legacy open admission before invoking gcloud", async () => {
  const calls = [];
  const result = await deployCloudRunService({ ...target, image: "example.invalid/image@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", allowUnauthenticated: false }, { gcloud: async (args) => { calls.push(args); return "{}"; } });
  assert.equal(result.code, "legacy-allow-unauthenticated");
  assert.equal(calls.length, 0);
});

test("package catalog, descriptor, and dispatcher agree on every operation", async () => {
  const catalog = Object.keys(packageMetadata["x-agentic-metro-enterprise"]["operation-catalog"]).sort();
  const voxel = [...packageMetadata["x-semiotic-voxel"].operations].sort();
  const descriptor = [...controlPlaneDescriptor().operations].sort();
  assert.deepEqual(catalog, voxel);
  assert.deepEqual(descriptor, voxel);
  assert.deepEqual([...capabilityCell.operations].sort(), voxel);
  assert.equal(capabilityCell.package.version, packageMetadata.version);
  assert.equal(agentCard.version, packageMetadata.version);
  const result = await actuate({ operation: "reconcile-cloud-run-invocation-admission", ...target, invocationAdmission: publicAdmission }, { gcloud: async () => JSON.stringify({ bindings: [{ role: "roles/run.invoker", members: ["allUsers"] }] }) });
  assert.equal(result.receipt.object.name, "reconcile-cloud-run-invocation-admission");
});
