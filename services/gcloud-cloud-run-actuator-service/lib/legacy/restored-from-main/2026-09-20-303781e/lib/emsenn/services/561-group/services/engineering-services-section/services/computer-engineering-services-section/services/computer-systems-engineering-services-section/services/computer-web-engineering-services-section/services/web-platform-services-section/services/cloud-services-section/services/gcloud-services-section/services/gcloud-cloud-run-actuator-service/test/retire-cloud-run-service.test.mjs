import assert from "node:assert/strict";
import test from "node:test";
import { actuate, retireCloudRunService } from "../src/gcloud-cloud-run-actuator.mjs";

const target = Object.freeze({ project: "five-six-one-group-dev", region: "us-central1", service: "static-duplicate" });
const replacementReceiptDigest = `ni:///sha-256;${"A".repeat(43)}`;
const request = Object.freeze({ ...target, confirmation: "retire-cloud-run-duplicate", replacementReceiptDigest });

test("retires only the requested Cloud Run duplicate after a replacement receipt is bound and 404 is observed", async () => {
  const calls = [];
  const result = await retireCloudRunService(request, { gcloud: async (args) => {
    calls.push(args);
    const command = args.join(" ");
    if (command.includes("services describe") && calls.length === 1) return JSON.stringify({ metadata: { name: target.service }, status: { url: "https://static-duplicate.example" } });
    if (command.includes("services delete")) return "";
    throw new Error("NOT_FOUND: service does not exist");
  } });
  assert.equal(result.receipt.object.content.absent, true);
  assert.equal(result.receipt.object.content.replacementReceiptDigest, replacementReceiptDigest);
  assert.equal(calls[0].join(" ").includes("services describe static-duplicate"), true);
  assert.equal(calls[1].join(" ").includes("services delete static-duplicate"), true);
  assert.equal(calls[2].join(" ").includes("services describe static-duplicate"), true);
});

test("refuses before GCP observation without both explicit confirmation and a replacement receipt", async () => {
  let calls = 0;
  await assert.rejects(() => retireCloudRunService({ ...target, replacementReceiptDigest }, { gcloud: async () => { calls += 1; return "{}"; } }), /explicit retire-cloud-run-duplicate/u);
  await assert.rejects(() => retireCloudRunService({ ...target, confirmation: "retire-cloud-run-duplicate", replacementReceiptDigest: "not-a-digest" }, { gcloud: async () => { calls += 1; return "{}"; } }), /replacement receipt digest/u);
  assert.equal(calls, 0);
});

test("does not report success when deletion leaves the service discoverable", async () => {
  const calls = [];
  await assert.rejects(() => actuate({ operation: "retire-cloud-run-service", ...request }, { gcloud: async (args) => {
    calls.push(args);
    if (args.includes("delete")) return "";
    return JSON.stringify({ metadata: { name: target.service } });
  } }), /remains discoverable/u);
  assert.equal(calls.some((args) => args.includes("delete")), true);
});
