import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CloudRunJobImageTransactionError,
  activeCloudRunJobExecutions,
  normalizeCloudRunJobDesiredSpec,
  normalizeCloudRunJobExecution,
  observeCloudRunJobDesiredSpec,
  transactCloudRunJobImage,
  waitForCloudRunJobExecution,
} from "../src/gcloud-cloud-run-actuator.mjs";

const fixture = async (name) => JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const target = { project: "example-project", region: "us-central1", job: "daily-worker" };
const priorImage = "us-central1-docker.pkg.dev/example-project/jobs/worker@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const image = "us-central1-docker.pkg.dev/example-project/jobs/worker@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const observedAt = "2026-08-16T12:00:00.000Z", expiresAt = "2026-08-16T12:05:00.000Z";
const observations = {
  pauseObservation: { type: "CloudRunJobMutationPauseObservation", subject: target, authority: "urn:example:release-controller", paused: true, observedAt, expiresAt },
  idleObservation: { type: "CloudRunJobIdleObservation", subject: target, activeExecutions: [], observedAt, expiresAt },
};
const request = { operation: "transact-cloud-run-job-image", ...target, image, ...observations };

test("normalizes live-shaped v1 and v2 desired specs onto the same image-only comparison model", async () => {
  const v1 = await fixture("cloud-run-job-v1.json"), v2 = await fixture("cloud-run-job-v2.json");
  const left = normalizeCloudRunJobDesiredSpec(v1), right = normalizeCloudRunJobDesiredSpec(v2);
  assert.equal(left.taskTemplate.containers[0].image, priorImage);
  assert.equal(right.taskTemplate.containers[0].image, image);
  right.taskTemplate.containers[0].image = priorImage;
  assert.deepEqual(right, left);
  assert.equal(JSON.stringify(left).includes("operation-id"), false);
});

test("updates only a digest-pinned image and returns normalized readback proof", async () => {
  const before = await fixture("cloud-run-job-v1.json"), after = await fixture("cloud-run-job-v2.json"), calls = [];
  const result = await transactCloudRunJobImage(request, { now: Date.parse("2026-08-16T12:01:00.000Z"), gcloud: async (args) => {
    calls.push(args);
    if (args.includes("update")) return "{}";
    return JSON.stringify(calls.filter((call) => call.includes("describe")).length === 1 ? before : after);
  } });
  const content = result.receipt.object.content;
  assert.equal(content.type, "CloudRunJobImageTransactionReceipt");
  assert.equal(content.action, "updated");
  assert.equal(content.priorImage, priorImage);
  assert.equal(content.after.desiredSpec.taskTemplate.containers[0].image, image);
  const update = calls.find((call) => call.includes("update"));
  assert.deepEqual(update.slice(update.indexOf("--image"), update.indexOf("--image") + 2), ["--image", image]);
  assert.equal(update.some((value) => /scheduler/iu.test(value)), false);
});

test("owner observes a normalized desired-spec precondition and transaction repeats it before mutation", async () => {
  const before = await fixture("cloud-run-job-v1.json"), drifted = await fixture("cloud-run-job-v2.json"), expectedDesiredSpec = normalizeCloudRunJobDesiredSpec(before), calls = [];
  const observation = await observeCloudRunJobDesiredSpec({ ...target, expectedDesiredSpec }, { gcloud: async (args) => { calls.push(args); return JSON.stringify(before); } });
  assert.equal(observation.receipt.object.content.matched, true);
  assert.equal(calls[0].join(" ").includes("run jobs describe"), true);
  await assert.rejects(observeCloudRunJobDesiredSpec({ ...target, expectedDesiredSpec }, { gcloud: async () => JSON.stringify(drifted) }), /does not equal/u);
  const mutationCalls = [];
  await assert.rejects(transactCloudRunJobImage({ ...request, expectedCurrentDesiredSpec: expectedDesiredSpec }, { now: Date.parse("2026-08-16T12:01:00.000Z"), gcloud: async (args) => { mutationCalls.push(args); return JSON.stringify(drifted); } }), /transaction precondition/u);
  assert.equal(mutationCalls.some((args) => args.includes("update")), false);
});

test("refuses stale or foreign pause/idle observations before cloud access", async () => {
  let called = false;
  await assert.rejects(transactCloudRunJobImage({ ...request, pauseObservation: { ...request.pauseObservation, subject: { ...target, job: "other-job" } } }, { now: Date.parse("2026-08-16T12:01:00.000Z"), gcloud: async () => { called = true; } }), /does not bind/u);
  await assert.rejects(transactCloudRunJobImage(request, { now: Date.parse("2026-08-16T12:06:00.000Z"), gcloud: async () => { called = true; } }), /not currently valid/u);
  assert.equal(called, false);
});

test("compensates to and proves the complete prior desired spec after mismatched readback", async () => {
  const before = await fixture("cloud-run-job-v1.json"), after = await fixture("cloud-run-job-v2.json"), calls = [];
  after.template.template.containers[0].resources.limits.cpu = "4";
  await assert.rejects(transactCloudRunJobImage(request, { now: Date.parse("2026-08-16T12:01:00.000Z"), gcloud: async (args) => {
    calls.push(args);
    const describes = calls.filter((call) => call.includes("describe")).length;
    if (args.includes("describe")) return JSON.stringify(describes === 1 ? before : describes === 2 ? after : before);
    return "{}";
  } }), (error) => error instanceof CloudRunJobImageTransactionError && error.details.compensation === "verified");
  const updateImages = calls.filter((call) => call.includes("update")).map((call) => call[call.indexOf("--image") + 1]);
  assert.deepEqual(updateImages, [image, priorImage]);
});

test("compensates after an update error because the remote effect is uncertain", async () => {
  const before = await fixture("cloud-run-job-v1.json"), calls = [];
  await assert.rejects(transactCloudRunJobImage(request, { now: Date.parse("2026-08-16T12:01:00.000Z"), gcloud: async (args) => {
    calls.push(args);
    if (args.includes("describe")) return JSON.stringify(before);
    const requested = args[args.indexOf("--image") + 1];
    if (requested === image) throw new Error("deadline exceeded after dispatch");
    return "{}";
  } }), (error) => error instanceof CloudRunJobImageTransactionError && error.details.compensation === "verified" && /deadline exceeded/u.test(error.cause.message));
  assert.deepEqual(calls.filter((call) => call.includes("update")).map((call) => call[call.indexOf("--image") + 1]), [image, priorImage]);
});

test("normalizes live-shaped v1 success and v2 failure into typed, non-invented exits", async () => {
  const success = normalizeCloudRunJobExecution(await fixture("cloud-run-execution-v1.json"));
  const failedFixture = await fixture("cloud-run-execution-v2.json"), failure = normalizeCloudRunJobExecution(failedFixture);
  assert.deepEqual([success.terminalState, success.outcome.classification, success.outcome.taskCounts.succeeded], ["CONDITION_SUCCEEDED", "succeeded", 2]);
  assert.deepEqual([failure.terminalState, failure.outcome.classification, failure.outcome.taskCounts.retried], ["CONDITION_FAILED", "failed", 2]);
  assert.equal(success.exit.processExitCode, null);
  assert.equal(failure.exit.reason, "NON_ZERO_EXIT_CODE");
  failedFixture.terminalCondition.executionReason = "CANCELLED";
  assert.equal(normalizeCloudRunJobExecution(failedFixture).outcome.classification, "cancelled");
  const running = structuredClone(failedFixture); running.terminalCondition.state = "CONDITION_RECONCILING";
  assert.deepEqual(activeCloudRunJobExecutions([await fixture("cloud-run-execution-v1.json"), failedFixture, running]).map(({ name }) => name), [running.name]);
});

test("waits through nonterminal v1 state and returns a typed terminal receipt", async () => {
  const running = await fixture("cloud-run-execution-v1.json"), failed = await fixture("cloud-run-execution-v2.json"), pauses = [];
  running.status.conditions[0].status = "Unknown";
  const observations = [running, failed];
  const result = await waitForCloudRunJobExecution({ operation: "wait-cloud-run-job-execution", ...target, execution: "daily-worker-4m8kw", maxAttempts: 2, pollIntervalMilliseconds: 7 }, { gcloud: async () => JSON.stringify(observations.shift()), pause: async (milliseconds) => pauses.push(milliseconds) });
  const content = result.receipt.object.content;
  assert.equal(content.type, "CloudRunJobExecutionTerminalReceipt");
  assert.equal(content.outcome.classification, "failed");
  assert.equal(content.attempts, 2);
  assert.deepEqual(pauses, [7]);
});
