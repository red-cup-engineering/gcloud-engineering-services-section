import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { isObjectRecord } from "../../../../../../../../../../../../computer-data-engineering-services-section/services/serialized-computer-data-engineering-services-section/services/json-services-section/src/index.mjs";

export const ACTOR_ID = "urn:ame:gcloud-cloud-run-actuator-service";
// Cloud Run's addressable staged route reserves the remainder of its DNS
// segment outside this pair.  Keep this provider rule here so callers do not
// each invent a different safe tag budget.
export const CLOUD_RUN_TAGGED_ROUTE_LIMITS = Object.freeze({ maxServiceAndTagCharacters: 46 });
const SERVICE_NAME = /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/u;
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u;
const REGION = /^[a-z]+-[a-z]+[0-9]$/u;
const IMAGE = /^(?:[a-z0-9][a-z0-9._-]*\.)?[a-z0-9][a-z0-9._/-]*(?::[A-Za-z0-9._-]+|@sha256:[a-f0-9]{64})$/u;
const DIGEST_IMAGE = /@sha256:[a-f0-9]{64}$/u;
const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;
const SERVICE_ACCOUNT = /^[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\.iam|developer)\.gserviceaccount\.com$/u;
const REVISION = /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/u;
const REVISION_TAG = /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/u;
const EXECUTION_NAME = /^(?:projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/locations\/[a-z]+-[a-z]+[0-9]\/jobs\/[a-z]([-a-z0-9]{0,61}[a-z0-9])?\/executions\/)?[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/u;
const TERMINAL_EXECUTION_STATES = new Set(["CONDITION_SUCCEEDED", "CONDITION_FAILED", "CONDITION_CANCELLED"]);
const OUTPUT_JOB_ANNOTATIONS = new Set(["run.googleapis.com/client-name", "run.googleapis.com/client-version", "run.googleapis.com/creator", "run.googleapis.com/lastModifier", "run.googleapis.com/operation-id"]);
const OUTPUT_JOB_LABELS = new Set(["cloud.googleapis.com/location", "run.googleapis.com/lastUpdatedTime"]);
const OUTPUT_TEMPLATE_ANNOTATIONS = new Set(["run.googleapis.com/client-name", "run.googleapis.com/client-version"]);
const OUTPUT_TEMPLATE_LABELS = new Set(["client.knative.dev/nonce"]);
const OBSERVATION_VALIDITY_LIMIT_MS = 10 * 60 * 1000;
const ACTIVITY_CONTEXT = "https://www.w3.org/ns/activitystreams";
const UUID_V4 = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const NI_SHA256 = /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u;

function requireString(value, name, expression) {
  if (typeof value !== "string" || !expression.test(value)) throw new Error(`invalid ${name}`);
  return value;
}
function cloudTarget(input) {
  return {
    project: requireString(input.project, "Google Cloud project", PROJECT_ID),
    region: requireString(input.region, "Cloud Run region", REGION),
    service: requireString(input.service, "Cloud Run service", SERVICE_NAME),
  };
}
function jobTarget(input) {
  return { project: requireString(input.project, "Google Cloud project", PROJECT_ID), region: requireString(input.region, "Cloud Run region", REGION), job: requireString(input.job, "Cloud Run job", SERVICE_NAME) };
}
function stagedRevisionTag(target, value) {
  const tag = requireString(value, "staged revision tag", REVISION_TAG);
  if (target.service.length + tag.length > CLOUD_RUN_TAGGED_ROUTE_LIMITS.maxServiceAndTagCharacters) {
    throw new Error("Cloud Run service and staged revision tag exceed the addressable route limit");
  }
  return tag;
}
function immutableImage(value) {
  const image = requireString(value, "container image", IMAGE);
  if (!DIGEST_IMAGE.test(image)) throw new Error("container image must be pinned by sha256 digest");
  return image;
}
function canonicalOrigin(value) {
  let origin;
  try { origin = new URL(value); } catch { throw new Error("invalid canonical service origin"); }
  if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password) throw new Error("canonical service origin must be an HTTPS origin without a path");
  return origin.origin;
}
function gcloud(args, { env = process.env, cwd, gcloud: execute } = {}) {
  if (typeof execute === "function") return execute(args);
  const executable = env.GCLOUD_BIN ?? "gcloud";
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env: { ...env, CLOUDSDK_CORE_DISABLE_PROMPTS: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    const output = []; const errors = [];
    child.stdout.on("data", (chunk) => output.push(chunk));
    child.stderr.on("data", (chunk) => errors.push(chunk));
    child.on("error", (error) => reject(new Error(`gcloud unavailable: ${error.message}`)));
    child.on("close", (code) => {
      const stdout = Buffer.concat(output).toString("utf8");
      const stderr = Buffer.concat(errors).toString("utf8");
      if (code !== 0) reject(new Error(`gcloud exited ${code}: ${stderr.trim() || stdout.trim()}`));
      else resolve(stdout);
    });
  });
}
function digest(value) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonical(value[key])]));
  return value;
}
function identifyCanonicalJson(value) { return `ni:///sha-256;${createHash("sha256").update(JSON.stringify(canonical(value))).digest("base64url")}`; }
function activity(operation, request, result) {
  const id = `urn:uuid:${randomUUID()}`;
  const now = new Date().toISOString();
  const receipt = { "@context": "https://www.w3.org/ns/activitystreams", id, type: "Create", actor: ACTOR_ID, published: now, object: { type: "Activity", name: operation, content: result, attributedTo: ACTOR_ID }, "union:requestDigest": digest(JSON.stringify(request)) };
  return Object.freeze({ receipt, jsonl: `${JSON.stringify(receipt)}\n` });
}
function exactKeys(value, keys) {
  return isObjectRecord(value) && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
function requireJsonValue(value, label, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw serviceReceiptError("receipt-envelope-invalid", `${label} contains a non-finite number`);
    return;
  }
  if (typeof value !== "object" || seen.has(value)) throw serviceReceiptError("receipt-envelope-invalid", `${label} is not an acyclic JSON value`);
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) throw serviceReceiptError("receipt-envelope-invalid", `${label} contains a non-JSON object`);
  seen.add(value);
  for (const child of Array.isArray(value) ? value : Object.values(value)) requireJsonValue(child, label, seen);
  seen.delete(value);
}
function serviceReceiptError(code, message, details = {}) {
  return new CloudRunServiceReceiptAdmissionError(message, code, details);
}
function exactInstant(value, label) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) throw serviceReceiptError("receipt-envelope-invalid", `invalid ${label}`);
  return value;
}
function positiveGeneration(value, label) {
  const generation = Number(value);
  if (!Number.isInteger(generation) || generation < 1) throw serviceReceiptError("receipt-result-invalid", `invalid ${label}`);
  return generation;
}
function exactHttpsOrigin(value, label) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.origin !== value || url.pathname !== "/" || url.search || url.hash || url.username || url.password) throw new Error("not an origin");
    return value;
  } catch { throw serviceReceiptError("receipt-result-invalid", `invalid ${label}`); }
}
function sameCloudTarget(value, target) {
  return exactKeys(value, ["project", "region", "service"])
    && value.project === target.project && value.region === target.region && value.service === target.service;
}
function admittedTraffic(value, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || !allowEmpty && value.length === 0) throw serviceReceiptError("receipt-result-invalid", "invalid Cloud Run traffic result");
  let total = 0;
  for (const entry of value) {
    if (!isObjectRecord(entry) || typeof entry.revisionName !== "string" && entry.latestRevision !== true) throw serviceReceiptError("receipt-result-invalid", "invalid Cloud Run traffic target");
    if (entry.revisionName !== undefined && !REVISION.test(entry.revisionName)) throw serviceReceiptError("receipt-result-invalid", "invalid Cloud Run traffic revision");
    const percent = entry.percent === undefined ? 0 : Number(entry.percent);
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) throw serviceReceiptError("receipt-result-invalid", "invalid Cloud Run traffic percentage");
    if (entry.url !== undefined) exactHttpsOrigin(entry.url, "Cloud Run tagged origin");
    total += percent;
  }
  if (total > 100) throw serviceReceiptError("receipt-result-invalid", "Cloud Run traffic exceeds 100 percent");
  return value;
}
function resourceBasename(value) { return typeof value === "string" ? value.slice(value.lastIndexOf("/") + 1) : value; }
function serviceTemplateSpec(value) { const template = value?.spec?.template ?? {}; return template.spec ?? template; }
function serviceTraffic(value) {
  return (value?.status?.traffic ?? value?.traffic ?? []).map((entry) => ({
    ...entry, revisionName: resourceBasename(entry.revisionName ?? entry.revision), percent: entry.percent, latestRevision: entry.latestRevision,
  }));
}
function exactServiceResultState(value, target, { label, requireImage } = {}) {
  if (!isObjectRecord(value)) throw serviceReceiptError("receipt-result-invalid", `${label} must contain Cloud Run service state`);
  const observedName = resourceBasename(value.metadata?.name ?? value.name);
  if (observedName !== undefined && observedName !== target.service) throw serviceReceiptError("receipt-target-drift", `${label} names another Cloud Run service`);
  const generation = positiveGeneration(value.metadata?.generation ?? value.generation, `${label} generation`);
  const origin = exactHttpsOrigin(value.status?.url ?? value.uri, `${label} origin`);
  const revision = resourceBasename(value.status?.latestReadyRevisionName ?? value.latestReadyRevision);
  if (typeof revision !== "string" || !REVISION.test(revision)) throw serviceReceiptError("receipt-result-invalid", `invalid ${label} latest ready revision`);
  admittedTraffic(serviceTraffic(value));
  if (requireImage !== undefined) {
    const image = serviceTemplateSpec(value).containers?.[0]?.image;
    if (image !== requireImage) throw serviceReceiptError("receipt-result-drift", `${label} image differs from the staged request`);
  }
  return { generation, origin, revision };
}

export class CloudRunServiceReceiptAdmissionError extends TypeError {
  constructor(message, code, details = {}) {
    super(message);
    this.name = "CloudRunServiceReceiptAdmissionError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function admittedServiceEnvelope(envelope, operation, request) {
  if (!exactKeys(envelope, ["receipt", "jsonl"]) || !isObjectRecord(envelope.receipt)) throw serviceReceiptError("receipt-envelope-invalid", "Cloud Run service receipt must be the actuator's exact receipt/jsonl envelope");
  const receipt = envelope.receipt;
  requireJsonValue(receipt, "Cloud Run service receipt");
  if (!exactKeys(receipt, ["@context", "id", "type", "actor", "published", "object", "union:requestDigest"])
    || receipt["@context"] !== ACTIVITY_CONTEXT || receipt.type !== "Create" || receipt.actor !== ACTOR_ID
    || !UUID_V4.test(receipt.id ?? "") || !SHA256.test(receipt["union:requestDigest"] ?? "")
    || !exactKeys(receipt.object, ["type", "name", "content", "attributedTo"])
    || receipt.object.type !== "Activity" || receipt.object.name !== operation || receipt.object.attributedTo !== ACTOR_ID || !isObjectRecord(receipt.object.content)) {
    throw serviceReceiptError("receipt-envelope-invalid", `value is not an exact ${operation} actuator receipt`);
  }
  exactInstant(receipt.published, "Cloud Run service receipt publication instant");
  if (envelope.jsonl !== `${JSON.stringify(receipt)}\n`) throw serviceReceiptError("receipt-envelope-invalid", "Cloud Run service receipt JSONL disagrees with its event");
  const requestDigest = digest(JSON.stringify(request));
  if (receipt["union:requestDigest"] !== requestDigest) throw serviceReceiptError("receipt-request-drift", `${operation} receipt does not bind the supplied exact request`, { expected: requestDigest, actual: receipt["union:requestDigest"] });
  const admittedReceipt = deepFreeze(structuredClone(receipt));
  return { receipt: admittedReceipt, content: admittedReceipt.object.content, requestDigest, published: admittedReceipt.published, id: identifyCanonicalJson(admittedReceipt) };
}
function domainTarget(input) {
  return { ...cloudTarget(input), domain: requireString(input.domain, "Cloud Run domain", DOMAIN) };
}
function mappingRoute(mapping) {
  return mapping?.status?.mappedRouteName ?? mapping?.spec?.routeName ?? null;
}
function notFound(error) {
  return /(?:NOT_FOUND|not found|does not exist)/iu.test(String(error?.message ?? error));
}
function withoutKeys(value, keys) { return Object.fromEntries(Object.entries(value ?? {}).filter(([key]) => !keys.has(key))); }
function seconds(value) {
  const raw = typeof value === "number" ? String(value) : value;
  if (typeof raw !== "string" || !/^[0-9]+s?$/u.test(raw)) throw new Error("invalid Cloud Run duration");
  return `${raw.replace(/s$/u, "")}s`;
}
function normalizedSecretReference(reference) {
  const secret = reference?.secret ?? reference?.name;
  const version = reference?.version ?? reference?.key ?? "latest";
  return secret ? { secret, version } : reference;
}
function normalizedContainer(container) {
  const normalized = structuredClone(container);
  normalized.env = (normalized.env ?? []).map((entry) => {
    const secret = entry?.valueSource?.secretKeyRef ?? entry?.valueFrom?.secretKeyRef;
    if (!secret) return canonical(entry);
    return canonical({ name: entry.name, valueSource: { secretKeyRef: normalizedSecretReference(secret) } });
  });
  return canonical(normalized);
}
function normalizedVolume(volume) {
  const normalized = structuredClone(volume);
  if (normalized.secret) {
    normalized.secret = {
      ...normalized.secret,
      secret: normalized.secret.secret ?? normalized.secret.secretName,
      items: (normalized.secret.items ?? []).map((item) => ({ ...item, version: item.version ?? item.key })),
    };
    delete normalized.secret.secretName;
    for (const item of normalized.secret.items) delete item.key;
  }
  return canonical(normalized);
}
function assertOnlyKeys(value, allowed, label) {
  const unexpected = Object.keys(value ?? {}).filter((key) => !allowed.has(key));
  if (unexpected.length) throw new Error(`${label} contains unsupported fields: ${unexpected.sort().join(", ")}`);
}

/** Normalize caller-controlled Cloud Run Job desired state across v1 and v2 JSON. */
export function normalizeCloudRunJobDesiredSpec(job) {
  const v1 = job?.apiVersion === "run.googleapis.com/v1" || job?.spec?.template?.spec?.template?.spec;
  const execution = v1 ? job?.spec?.template?.spec : job?.template;
  const task = v1 ? execution?.template?.spec : execution?.template;
  if (!execution || !task || !Array.isArray(task.containers) || task.containers.length !== 1) throw new Error("Cloud Run Job must contain exactly one container");
  if (v1) {
    assertOnlyKeys(job.spec, new Set(["template"]), "Cloud Run v1 Job spec");
    assertOnlyKeys(execution, new Set(["parallelism", "taskCount", "template"]), "Cloud Run v1 execution template");
    assertOnlyKeys(task, new Set(["containers", "maxRetries", "serviceAccountName", "timeoutSeconds", "volumes", "encryptionKey", "executionEnvironment", "nodeSelector", "vpcAccess"]), "Cloud Run v1 task template");
  } else {
    assertOnlyKeys(job, new Set(["name", "uid", "generation", "labels", "annotations", "createTime", "updateTime", "deleteTime", "expireTime", "creator", "lastModifier", "client", "clientVersion", "executionCount", "latestCreatedExecution", "reconciling", "terminalCondition", "conditions", "observedGeneration", "etag", "satisfiesPzs", "launchStage", "binaryAuthorization", "runExecutionToken", "startExecutionToken", "template"]), "Cloud Run v2 Job");
    assertOnlyKeys(execution, new Set(["labels", "annotations", "client", "clientVersion", "delayExecution", "parallelism", "priorityTier", "taskCount", "template"]), "Cloud Run v2 execution template");
    assertOnlyKeys(task, new Set(["containers", "maxRetries", "serviceAccount", "timeout", "volumes", "encryptionKey", "executionEnvironment", "gpuZonalRedundancyDisabled", "nodeSelector", "terminationGracePeriod", "vpcAccess"]), "Cloud Run v2 task template");
  }
  const metadata = v1 ? job.metadata : job;
  const executionMetadata = v1 ? job?.spec?.template?.metadata : execution;
  return canonical({
    metadata: { annotations: withoutKeys(metadata?.annotations, OUTPUT_JOB_ANNOTATIONS), labels: withoutKeys(metadata?.labels, OUTPUT_JOB_LABELS) },
    ...(job.binaryAuthorization === undefined ? {} : { binaryAuthorization: job.binaryAuthorization }),
    ...(job.launchStage === undefined ? {} : { launchStage: job.launchStage }),
    ...(job.runExecutionToken === undefined ? {} : { runExecutionToken: job.runExecutionToken }),
    ...(job.startExecutionToken === undefined ? {} : { startExecutionToken: job.startExecutionToken }),
    executionTemplate: {
      annotations: withoutKeys(executionMetadata?.annotations, OUTPUT_TEMPLATE_ANNOTATIONS),
      labels: withoutKeys(executionMetadata?.labels, OUTPUT_TEMPLATE_LABELS),
      parallelism: execution.parallelism,
      ...(execution.delayExecution === undefined ? {} : { delayExecution: execution.delayExecution }),
      ...(execution.priorityTier === undefined ? {} : { priorityTier: execution.priorityTier }),
      taskCount: execution.taskCount,
    },
    taskTemplate: {
      containers: task.containers.map(normalizedContainer),
      maxRetries: task.maxRetries,
      serviceAccount: task.serviceAccount ?? task.serviceAccountName,
      timeout: seconds(task.timeout ?? task.timeoutSeconds),
      volumes: (task.volumes ?? []).map(normalizedVolume),
      ...(task.encryptionKey === undefined ? {} : { encryptionKey: task.encryptionKey }),
      ...(task.executionEnvironment === undefined ? {} : { executionEnvironment: task.executionEnvironment }),
      ...(task.gpuZonalRedundancyDisabled === undefined ? {} : { gpuZonalRedundancyDisabled: task.gpuZonalRedundancyDisabled }),
      ...(task.nodeSelector === undefined ? {} : { nodeSelector: task.nodeSelector }),
      ...(task.terminationGracePeriod === undefined ? {} : { terminationGracePeriod: task.terminationGracePeriod }),
      ...(task.vpcAccess === undefined ? {} : { vpcAccess: task.vpcAccess }),
    },
  });
}
function jobImage(job) { return normalizeCloudRunJobDesiredSpec(job).taskTemplate.containers[0].image; }
function admittedExpectedDesiredSpec(value) {
  if (!isObjectRecord(value)) throw new Error("expected Cloud Run Job desired spec must be a normalized object");
  const normalized = canonical(value);
  if (JSON.stringify(normalized) !== JSON.stringify(value) || !Array.isArray(normalized.taskTemplate?.containers) || normalized.taskTemplate.containers.length !== 1) throw new Error("expected Cloud Run Job desired spec is not canonical normalized state");
  requireString(normalized.taskTemplate.containers[0].image, "expected container image", IMAGE);
  return normalized;
}
function imageOnlyReadback(before, after, image) {
  const left = normalizeCloudRunJobDesiredSpec(before), right = normalizeCloudRunJobDesiredSpec(after);
  if (right.taskTemplate.containers[0].image !== image) return false;
  right.taskTemplate.containers[0].image = left.taskTemplate.containers[0].image;
  return JSON.stringify(left) === JSON.stringify(right);
}
function observationInstant(value, label) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new Error(`invalid ${label}`);
  return Date.parse(value);
}
function exactObservationSubject(value, target, label) {
  if (!value || value.project !== target.project || value.region !== target.region || value.job !== target.job) throw new Error(`${label} does not bind the requested Cloud Run Job`);
}
function admitJobMutationObservations(input, target, now = Date.now()) {
  const pause = input.pauseObservation, idle = input.idleObservation;
  if (pause?.type !== "CloudRunJobMutationPauseObservation" || pause.paused !== true || typeof pause.authority !== "string" || pause.authority.length === 0) throw new Error("an explicit external pause observation is required");
  if (idle?.type !== "CloudRunJobIdleObservation" || !Array.isArray(idle.activeExecutions) || idle.activeExecutions.length !== 0) throw new Error("an explicit idle observation with zero active executions is required");
  exactObservationSubject(pause.subject, target, "pause observation"); exactObservationSubject(idle.subject, target, "idle observation");
  for (const [label, observation] of [["pause observation", pause], ["idle observation", idle]]) {
    const observedAt = observationInstant(observation.observedAt, `${label} observedAt`), expiresAt = observationInstant(observation.expiresAt, `${label} expiresAt`);
    if (observedAt > now || expiresAt < now || expiresAt <= observedAt || expiresAt - observedAt > OBSERVATION_VALIDITY_LIMIT_MS) throw new Error(`${label} is not currently valid`);
  }
  return canonical({ pause, idle });
}

export class CloudRunJobImageTransactionError extends Error {
  constructor(message, details, cause) { super(message, { cause }); this.name = "CloudRunJobImageTransactionError"; this.details = Object.freeze(details); }
}

/** Observe and prove equality with one previously captured normalized Job desired spec. */
export async function observeCloudRunJobDesiredSpec(input, options = {}) {
  const target = jobTarget(input), expected = admittedExpectedDesiredSpec(input.expectedDesiredSpec);
  const observed = JSON.parse(await gcloud(["run", "jobs", "describe", target.job, "--project", target.project, "--region", target.region, "--format=json", "--quiet"], options));
  const desiredSpec = normalizeCloudRunJobDesiredSpec(observed);
  if (JSON.stringify(desiredSpec) !== JSON.stringify(expected)) throw new Error("current Cloud Run Job desired spec does not equal the expected normalized state");
  return activity("observe-cloud-run-job-desired-spec", { ...target, expectedDesiredSpec: expected }, { type: "CloudRunJobDesiredSpecObservation", job: target, matched: true, generation: observed.generation ?? observed.metadata?.generation ?? null, desiredSpec });
}

/** Perform one image-only Job mutation and restore the prior image after any uncertain or mismatched effect. */
export async function transactCloudRunJobImage(input, options = {}) {
  const target = jobTarget(input), image = immutableImage(input.image);
  const now = typeof options.now === "function" ? options.now() : options.now ?? Date.now();
  const observations = admitJobMutationObservations(input, target, typeof now === "number" ? now : new Date(now).getTime());
  const common = ["--project", target.project, "--region", target.region, "--format=json", "--quiet"];
  const before = JSON.parse(await gcloud(["run", "jobs", "describe", target.job, ...common], options));
  const priorImage = requireString(jobImage(before), "prior container image", IMAGE);
  const beforeSpec = normalizeCloudRunJobDesiredSpec(before);
  if (input.expectedCurrentDesiredSpec !== undefined && JSON.stringify(beforeSpec) !== JSON.stringify(admittedExpectedDesiredSpec(input.expectedCurrentDesiredSpec))) throw new Error("current Cloud Run Job desired spec does not equal the transaction precondition");
  if (priorImage === image) return activity("transact-cloud-run-job-image", { ...target, image, observations }, { type: "CloudRunJobImageTransactionReceipt", job: target, action: "unchanged", priorImage, image, before: { generation: before.generation ?? before.metadata?.generation ?? null, desiredSpec: beforeSpec }, after: { generation: before.generation ?? before.metadata?.generation ?? null, desiredSpec: beforeSpec }, observations, compensation: null });
  let mutationAttempted = false;
  try {
    mutationAttempted = true;
    await gcloud(["run", "jobs", "update", target.job, "--image", image, ...common], options);
    const after = JSON.parse(await gcloud(["run", "jobs", "describe", target.job, ...common], options));
    if (!imageOnlyReadback(before, after, image)) throw new Error("Cloud Run Job readback changed more than the admitted image");
    return activity("transact-cloud-run-job-image", { ...target, image, observations }, { type: "CloudRunJobImageTransactionReceipt", job: target, action: "updated", priorImage, image, before: { generation: before.generation ?? before.metadata?.generation ?? null, desiredSpec: beforeSpec }, after: { generation: after.generation ?? after.metadata?.generation ?? null, desiredSpec: normalizeCloudRunJobDesiredSpec(after) }, observations, compensation: null });
  } catch (error) {
    if (!mutationAttempted) throw error;
    try {
      await gcloud(["run", "jobs", "update", target.job, "--image", priorImage, ...common], options);
      const compensated = JSON.parse(await gcloud(["run", "jobs", "describe", target.job, ...common], options));
      if (JSON.stringify(normalizeCloudRunJobDesiredSpec(compensated)) !== JSON.stringify(beforeSpec)) throw new Error("compensation readback does not equal the prior desired spec");
      throw new CloudRunJobImageTransactionError("Cloud Run Job image transaction failed; compensation to the prior desired spec was verified", { target, image, priorImage, compensation: "verified" }, error);
    } catch (compensationError) {
      if (compensationError instanceof CloudRunJobImageTransactionError) throw compensationError;
      throw new CloudRunJobImageTransactionError("Cloud Run Job image transaction failed and compensation could not be verified", { target, image, priorImage, compensation: "unverified", compensationError: compensationError.message }, error);
    }
  }
}
function requiredEnvironment(value) {
  if (!isObjectRecord(value)) throw new Error("invalid required environment");
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.some(([name, entry]) => !/^[A-Z][A-Z0-9_]*$/u.test(name) || typeof entry !== "string" || entry.includes(","))) throw new Error("invalid required environment");
  return Object.freeze(Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right))));
}
function requiredSecretBindings(value) {
  if (!isObjectRecord(value)) throw new Error("invalid Secret Manager bindings");
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.some(([target, secret]) => {
    const environment = /^[A-Z][A-Z0-9_]*$/u.test(target);
    const mount = /^\/secrets\/[a-z0-9][a-z0-9._/-]*$/u.test(target) && !target.includes("//") && !target.endsWith("/");
    return (!environment && !mount) || typeof secret !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,254}:(?:latest|[1-9][0-9]*)$/u.test(secret);
  })) throw new Error("invalid Secret Manager bindings");
  return Object.freeze(Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right))));
}
const PROBE_INTEGER = Object.freeze({ initialDelaySeconds: [0, 240], timeoutSeconds: [1, 240], periodSeconds: [1, 240], failureThreshold: [1, 240], successThreshold: [1, 240] });
function httpProbe(value, kind) {
  if (!isObjectRecord(value)) throw new Error(`invalid Cloud Run ${kind} probe`);
  const readiness = kind === "readiness";
  const keys = readiness
    ? ["httpGet", "timeoutSeconds", "periodSeconds", "failureThreshold", "successThreshold"]
    : ["httpGet", "initialDelaySeconds", "timeoutSeconds", "periodSeconds", "failureThreshold"];
  assertOnlyKeys(value, new Set(keys), `Cloud Run ${kind} probe`);
  if (keys.some((name) => !Object.hasOwn(value, name))) throw new Error(`Cloud Run ${kind} probe must contain every exact HTTP probe field`);
  assertOnlyKeys(value.httpGet, new Set(["path", "port"]), `Cloud Run ${kind} HTTP GET`);
  const path = requireString(value.httpGet?.path, `Cloud Run ${kind} probe path`, /^\/(?:[A-Za-z0-9._~!$&'()*+;=:@%-]+\/?)*$/u);
  if (path.includes(",")) throw new Error(`Cloud Run ${kind} probe path cannot contain a comma`);
  const port = value.httpGet?.port;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`invalid Cloud Run ${kind} probe port`);
  const result = { httpGet: { path, port } };
  for (const name of keys.filter((entry) => entry !== "httpGet")) {
    const [minimum, maximum] = PROBE_INTEGER[name];
    if (!Number.isInteger(value[name]) || value[name] < minimum || value[name] > maximum) throw new Error(`invalid Cloud Run ${kind} probe ${name}`);
    result[name] = value[name];
  }
  if (result.timeoutSeconds > result.periodSeconds) throw new Error(`Cloud Run ${kind} probe timeout cannot exceed its period`);
  return deepFreeze(result);
}
function probeFlag(value) {
  const entries = [
    ...Object.entries(value).filter(([name]) => name !== "httpGet"),
    ["httpGet.path", value.httpGet.path], ["httpGet.port", value.httpGet.port],
  ];
  return entries.map(([name, member]) => `${name}=${member}`).join(",");
}
function optionalBoolean(input, name, label, output) {
  if (input[name] !== undefined) {
    if (typeof input[name] !== "boolean") throw new Error(`${label} must be boolean`);
    output[name] = input[name];
  }
}
function optionalServiceConfiguration(input) {
  const output = {};
  if (input.serviceAccount !== undefined) output.serviceAccount = requireString(input.serviceAccount, "runtime service account", SERVICE_ACCOUNT);
  if (input.environment !== undefined) output.environment = requiredEnvironment(input.environment);
  if (input.secretBindings !== undefined) output.secretBindings = requiredSecretBindings(input.secretBindings);
  if (input.concurrency !== undefined) {
    if (!Number.isInteger(input.concurrency) || input.concurrency < 1 || input.concurrency > 1000) throw new Error("invalid Cloud Run concurrency");
    output.concurrency = input.concurrency;
  }
  if (input.cpu !== undefined) output.cpu = requireString(input.cpu, "Cloud Run CPU", /^[1-9][0-9]*$/u);
  if (input.memory !== undefined) output.memory = requireString(input.memory, "Cloud Run memory", /^[1-9][0-9]*(?:Mi|Gi)$/u);
  if (input.network !== undefined) output.network = requireString(input.network, "VPC network", /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/u);
  if (input.subnetwork !== undefined) output.subnetwork = requireString(input.subnetwork, "VPC subnetwork", /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/u);
  if (input.vpcEgress !== undefined) output.vpcEgress = requireString(input.vpcEgress, "VPC egress", /^(?:private-ranges-only|all-traffic)$/u);
  if (input.timeoutSeconds !== undefined) {
    if (!Number.isInteger(input.timeoutSeconds) || input.timeoutSeconds < 1 || input.timeoutSeconds > 3600) throw new Error("invalid Cloud Run timeout");
    output.timeoutSeconds = input.timeoutSeconds;
  }
  if (input.maxInstances !== undefined) {
    if (!Number.isInteger(input.maxInstances) || input.maxInstances < 1 || input.maxInstances > 1000) throw new Error("invalid Cloud Run max instances");
    output.maxInstances = input.maxInstances;
  }
  if (input.minInstances !== undefined) {
    if (!Number.isInteger(input.minInstances) || input.minInstances < 0 || input.minInstances > 1000) throw new Error("invalid Cloud Run min instances");
    output.minInstances = input.minInstances;
  }
  if (input.executionEnvironment !== undefined) output.executionEnvironment = requireString(input.executionEnvironment, "Cloud Run execution environment", /^(?:gen1|gen2)$/u);
  optionalBoolean(input, "cpuThrottling", "Cloud Run CPU throttling", output);
  optionalBoolean(input, "startupCpuBoost", "Cloud Run startup CPU boost", output);
  if (input.containerPort !== undefined) {
    if (!Number.isInteger(input.containerPort) || input.containerPort < 1 || input.containerPort > 65_535) throw new Error("invalid Cloud Run container port");
    output.containerPort = input.containerPort;
  }
  if (input.startupProbe !== undefined) output.startupProbe = httpProbe(input.startupProbe, "startup");
  if (input.readinessProbe !== undefined) output.readinessProbe = httpProbe(input.readinessProbe, "readiness");
  if (input.livenessProbe !== undefined) output.livenessProbe = httpProbe(input.livenessProbe, "liveness");
  if (input.ingress !== undefined) output.ingress = requireString(input.ingress, "Cloud Run ingress", /^(?:all|internal|internal-and-cloud-load-balancing)$/u);
  optionalBoolean(input, "deployHealthCheck", "Cloud Run deploy health check", output);
  return Object.freeze(output);
}
function declaredServiceConfiguration(input) {
  if (!Number.isInteger(input.concurrency) || input.concurrency < 1 || input.concurrency > 1000) throw new Error("invalid Cloud Run concurrency");
  if (!Number.isInteger(input.timeoutSeconds) || input.timeoutSeconds < 1 || input.timeoutSeconds > 3600) throw new Error("invalid Cloud Run timeout");
  if (!Number.isInteger(input.maxInstances) || input.maxInstances < 1 || input.maxInstances > 1000) throw new Error("invalid Cloud Run max instances");
  return Object.freeze({
    environment: requiredEnvironment(input.environment),
    concurrency: input.concurrency,
    cpu: requireString(input.cpu, "Cloud Run CPU", /^[1-9][0-9]*$/u),
    memory: requireString(input.memory, "Cloud Run memory", /^[1-9][0-9]*(?:Mi|Gi)$/u),
    serviceAccount: requireString(input.serviceAccount, "runtime service account", SERVICE_ACCOUNT),
    network: requireString(input.network, "VPC network", /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/u),
    subnetwork: requireString(input.subnetwork, "VPC subnetwork", /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/u),
    vpcEgress: requireString(input.vpcEgress, "VPC egress", /^(?:private-ranges-only|all-traffic)$/u),
    timeout: input.timeoutSeconds,
    maxInstances: input.maxInstances,
  });
}
function declaredJobConfiguration(input) {
  const base = declaredServiceConfiguration({ ...input, concurrency: 1, maxInstances: 1 });
  if (!Number.isInteger(input.tasks) || input.tasks < 1 || input.tasks > 10000) throw new Error("invalid Cloud Run Job tasks");
  if (!Number.isInteger(input.parallelism) || input.parallelism < 1 || input.parallelism > input.tasks) throw new Error("invalid Cloud Run Job parallelism");
  if (!Number.isInteger(input.maxRetries) || input.maxRetries < 0 || input.maxRetries > 10) throw new Error("invalid Cloud Run Job max retries");
  if (input.timeoutSeconds > 86400) throw new Error("invalid Cloud Run Job timeout");
  return Object.freeze({ ...base, tasks: input.tasks, parallelism: input.parallelism, maxRetries: input.maxRetries });
}
function jobMatches(job, image, configuration) {
  const template = job?.spec?.template?.spec ?? job?.spec?.template ?? {};
  const container = template.containers?.[0] ?? {};
  const network = job?.spec?.template?.metadata?.annotations?.["run.googleapis.com/network-interfaces"];
  return container.image === image && template.serviceAccountName === configuration.serviceAccount && template.timeoutSeconds === configuration.timeout
    && container.resources?.limits?.cpu === configuration.cpu && container.resources?.limits?.memory === configuration.memory
    && job?.spec?.parallelism === configuration.parallelism && job?.spec?.taskCount === configuration.tasks && job?.spec?.template?.spec?.maxRetries === configuration.maxRetries
    && Object.entries(configuration.environment).every(([name, value]) => environmentValues({ spec: { template: { spec: template } } })[name] === value)
    && typeof network === "string" && network.includes(configuration.network) && network.includes(configuration.subnetwork);
}

export async function discoverCloudRunJob(input, options) {
  const target = jobTarget(input);
  const observed = JSON.parse(await gcloud(["run", "jobs", "describe", target.job, "--project", target.project, "--region", target.region, "--format=json"], options));
  return activity("discover-cloud-run-job", target, { job: target, observed });
}
export async function deployCloudRunJob(input, options) {
  const target = jobTarget(input); const image = immutableImage(input.image); const configuration = declaredJobConfiguration(input);
  const args = ["run", "jobs", "deploy", target.job, "--project", target.project, "--region", target.region, "--image", image, "--service-account", configuration.serviceAccount, "--network", configuration.network, "--subnet", configuration.subnetwork, "--vpc-egress", configuration.vpcEgress, "--cpu", configuration.cpu, "--memory", configuration.memory, "--task-timeout", String(configuration.timeout), "--tasks", String(configuration.tasks), "--parallelism", String(configuration.parallelism), "--max-retries", String(configuration.maxRetries), "--set-env-vars", Object.entries(configuration.environment).map(([name, value]) => `${name}=${value}`).join(","), "--set-secrets", Object.entries(requiredSecretBindings(input.secretBindings)).map(([name, value]) => `${name}=${value}`).join(","), "--format=json", "--quiet"];
  const deployed = JSON.parse(await gcloud(args, options));
  return activity("deploy-cloud-run-job", { ...target, image, ...configuration, secretBindings: requiredSecretBindings(input.secretBindings) }, { job: target, image, deployed });
}
export async function reconcileCloudRunJob(input, options) {
  const target = jobTarget(input); const image = immutableImage(input.image); const configuration = declaredJobConfiguration(input); let observed;
  try { observed = JSON.parse(await gcloud(["run", "jobs", "describe", target.job, "--project", target.project, "--region", target.region, "--format=json"], options)); } catch (error) { if (!notFound(error)) throw error; observed = null; }
  const deployment = !observed || !jobMatches(observed, image, configuration) ? await deployCloudRunJob(input, options) : null;
  return activity("reconcile-cloud-run-job", { ...target, image, ...configuration, secretBindings: requiredSecretBindings(input.secretBindings) }, { job: target, image, action: deployment ? "deployed" : "unchanged", deployment: deployment?.receipt.object.content ?? null });
}
export async function executeCloudRunJob(input, options) {
  const target = jobTarget(input); const overrides = input.environmentOverrides === undefined ? {} : requiredEnvironment(input.environmentOverrides);
  const args = ["run", "jobs", "execute", target.job, "--project", target.project, "--region", target.region, "--format=json", "--quiet"];
  if (Object.keys(overrides).length) args.push("--update-env-vars", Object.entries(overrides).map(([name, value]) => `${name}=${value}`).join(","));
  const execution = JSON.parse(await gcloud(args, options));
  return activity("execute-cloud-run-job", { ...target, environmentOverrides: overrides }, { job: target, execution, state: normalizeCloudRunJobExecution(execution) });
}

/** Normalize Cloud Run v1/v2 execution conditions without inventing a process exit code. */
export function normalizeCloudRunJobExecution(execution) {
  if (!isObjectRecord(execution)) throw new Error("invalid Cloud Run Job execution");
  const name = execution.name ?? execution.metadata?.name;
  requireString(name, "Cloud Run Job execution name", EXECUTION_NAME);
  const v2 = execution.terminalCondition;
  const completed = (execution.status?.conditions ?? []).find((condition) => condition?.type === "Completed");
  let terminalState = TERMINAL_EXECUTION_STATES.has(v2?.state) ? v2.state : null;
  if (!terminalState && completed?.status === "True") terminalState = "CONDITION_SUCCEEDED";
  if (!terminalState && completed?.status === "False") terminalState = /cancel/iu.test(`${completed.reason ?? ""} ${completed.message ?? ""}`) ? "CONDITION_CANCELLED" : "CONDITION_FAILED";
  const condition = v2 ?? completed ?? null;
  const reason = condition?.executionReason ?? condition?.reason ?? null;
  if (terminalState === "CONDITION_FAILED" && reason === "CANCELLED") terminalState = "CONDITION_CANCELLED";
  const classification = terminalState === "CONDITION_SUCCEEDED" ? "succeeded" : terminalState === "CONDITION_FAILED" ? "failed" : terminalState === "CONDITION_CANCELLED" ? "cancelled" : "running";
  const count = (key) => {
    const value = execution[key] ?? execution.status?.[key] ?? 0;
    const parsed = typeof value === "string" && /^[0-9]+$/u.test(value) ? Number(value) : value;
    if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`invalid Cloud Run Job execution ${key}`);
    return parsed;
  };
  return canonical({
    type: "CloudRunJobExecutionState",
    name,
    terminal: terminalState !== null,
    terminalState,
    outcome: { type: "CloudRunJobExecutionOutcome", classification, taskCounts: { succeeded: count("succeededCount"), failed: count("failedCount"), cancelled: count("cancelledCount"), retried: count("retriedCount") } },
    exit: terminalState === null ? null : { type: "CloudRunJobExecutionExit", classification, processExitCode: null, reason, message: condition?.message ?? null },
    observed: execution,
  });
}

export function activeCloudRunJobExecutions(executions) {
  if (!Array.isArray(executions)) throw new Error("Cloud Run Job execution collection must be an array");
  return executions.filter((execution) => !normalizeCloudRunJobExecution(execution).terminal);
}

export async function waitForCloudRunJobExecution(input, options = {}) {
  const target = jobTarget(input), execution = requireString(input.execution, "Cloud Run Job execution name", EXECUTION_NAME);
  if (execution.includes("/") && execution !== `projects/${target.project}/locations/${target.region}/jobs/${target.job}/executions/${execution.split("/").at(-1)}`) throw new Error("Cloud Run Job execution name does not bind the requested target");
  const name = execution.split("/").at(-1);
  const maxAttempts = input.maxAttempts ?? 120, pollIntervalMilliseconds = input.pollIntervalMilliseconds ?? 5000;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 1000) throw new Error("invalid execution wait attempts");
  if (!Number.isInteger(pollIntervalMilliseconds) || pollIntervalMilliseconds < 0 || pollIntervalMilliseconds > 60000) throw new Error("invalid execution poll interval");
  const pause = options.pause ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  let state;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const observed = JSON.parse(await gcloud(["run", "jobs", "executions", "describe", name, "--project", target.project, "--region", target.region, "--format=json", "--quiet"], options));
    state = normalizeCloudRunJobExecution(observed);
    if (state.terminal) return activity("wait-cloud-run-job-execution", { ...target, execution: name, maxAttempts, pollIntervalMilliseconds }, { ...state, type: "CloudRunJobExecutionTerminalReceipt", job: target, attempts: attempt });
    if (attempt < maxAttempts) await pause(pollIntervalMilliseconds);
  }
  throw new Error(`Cloud Run Job execution ${name} did not reach a terminal state after ${maxAttempts} observations`);
}
function environmentValues(service) {
  const template = service?.spec?.template ?? {};
  return Object.fromEntries(((template.spec ?? template).containers?.[0]?.env ?? []).filter((entry) => typeof entry?.name === "string" && typeof entry?.value === "string").map((entry) => [entry.name, entry.value]));
}
function revisionEnvironmentValues(revision) {
  return Object.fromEntries((revision?.spec?.containers?.[0]?.env ?? []).filter((entry) => typeof entry?.name === "string" && typeof entry?.value === "string").map((entry) => [entry.name, entry.value]));
}
function revisionBelongsToService(revision, service, revisionName) {
  const metadata = revision?.metadata ?? {};
  if (typeof metadata.name === "string" && metadata.name !== revisionName) return false;
  const labels = metadata.labels ?? {};
  return labels["serving.knative.dev/service"] === service;
}
function networkInterface(service) {
  const encoded = service?.spec?.template?.metadata?.annotations?.["run.googleapis.com/network-interfaces"];
  try { const parsed = JSON.parse(encoded); return Array.isArray(parsed) ? parsed[0] ?? {} : {}; } catch { return {}; }
}
function observedSecretBindings(service) {
  const template = service?.spec?.template ?? {};
  const spec = template.spec ?? template;
  const container = spec.containers?.[0] ?? {};
  const bindings = {};
  for (const entry of container.env ?? []) {
    const reference = entry?.valueFrom?.secretKeyRef ?? entry?.valueSource?.secretKeyRef;
    if (!reference || typeof entry.name !== "string") continue;
    const normalized = normalizedSecretReference(reference);
    if (typeof normalized?.secret === "string" && typeof normalized?.version === "string") bindings[entry.name] = `${normalized.secret}:${normalized.version}`;
  }
  const volumes = new Map((spec.volumes ?? []).map((volume) => [volume.name, volume]));
  for (const mount of container.volumeMounts ?? []) {
    const secret = volumes.get(mount.name)?.secret;
    if (!secret || typeof mount.mountPath !== "string") continue;
    const name = secret.secretName ?? secret.secret;
    for (const item of secret.items ?? []) {
      const version = item.key ?? item.version;
      const itemPath = item.path ?? "";
      if (typeof name !== "string" || typeof version !== "string") continue;
      const target = itemPath && !mount.mountPath.endsWith(`/${itemPath}`) ? `${mount.mountPath.replace(/\/$/u, "")}/${itemPath}` : mount.mountPath;
      bindings[target] = `${name}:${version}`;
    }
  }
  return bindings;
}
function annotationBoolean(value) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return undefined;
}
function normalizedExecutionEnvironment(value) {
  if (value === "gen1" || value === "EXECUTION_ENVIRONMENT_GEN1") return "gen1";
  if (value === "gen2" || value === "EXECUTION_ENVIRONMENT_GEN2") return "gen2";
  return value;
}
function normalizedIngress(value) {
  const mapping = { INGRESS_TRAFFIC_ALL: "all", INGRESS_TRAFFIC_INTERNAL_ONLY: "internal", INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER: "internal-and-cloud-load-balancing" };
  return mapping[value] ?? value;
}
function normalizedVpcEgress(value) {
  const mapping = { VPC_EGRESS_PRIVATE_RANGES_ONLY: "private-ranges-only", PRIVATE_RANGES_ONLY: "private-ranges-only", VPC_EGRESS_ALL_TRAFFIC: "all-traffic", ALL_TRAFFIC: "all-traffic" };
  return mapping[value] ?? value;
}
function observedProbe(value, kind) {
  if (!isObjectRecord(value)) return undefined;
  try {
    const readiness = kind === "readiness";
    return httpProbe({
      httpGet: { path: value.httpGet?.path, port: Number(value.httpGet?.port) },
      ...(!readiness ? { initialDelaySeconds: Number(value.initialDelaySeconds ?? 0) } : {}),
      timeoutSeconds: Number(value.timeoutSeconds ?? 1), periodSeconds: Number(value.periodSeconds ?? 10), failureThreshold: Number(value.failureThreshold ?? 3),
      ...(readiness ? { successThreshold: Number(value.successThreshold ?? 1) } : {}),
    }, kind);
  } catch { return undefined; }
}
function observedServiceConfiguration(service) {
  const template = service?.spec?.template ?? {};
  const spec = template.spec ?? template;
  const container = spec.containers?.[0] ?? {};
  const annotations = template.metadata?.annotations ?? {};
  const serviceAnnotations = service?.metadata?.annotations ?? {};
  const cpuIdle = container.resources?.cpuIdle;
  return {
    minInstances: Number(annotations["autoscaling.knative.dev/minScale"] ?? template.scaling?.minInstanceCount),
    executionEnvironment: normalizedExecutionEnvironment(annotations["run.googleapis.com/execution-environment"] ?? spec.executionEnvironment ?? template.executionEnvironment),
    cpuThrottling: annotationBoolean(annotations["run.googleapis.com/cpu-throttling"]) ?? (typeof cpuIdle === "boolean" ? cpuIdle : undefined),
    startupCpuBoost: annotationBoolean(annotations["run.googleapis.com/startup-cpu-boost"]) ?? annotationBoolean(container.resources?.startupCpuBoost),
    containerPort: Number(container.ports?.[0]?.containerPort),
    startupProbe: observedProbe(container.startupProbe, "startup"), readinessProbe: observedProbe(container.readinessProbe, "readiness"), livenessProbe: observedProbe(container.livenessProbe, "liveness"),
    ingress: normalizedIngress(serviceAnnotations["run.googleapis.com/ingress"] ?? service?.ingress),
  };
}
function assertStagedServiceConfiguration(service, request) {
  const template = service?.spec?.template ?? {};
  const spec = template.spec ?? template;
  const container = spec.containers?.[0] ?? {};
  const annotations = template.metadata?.annotations ?? {};
  const network = networkInterface(service);
  const observed = environmentValues(service);
  const extended = observedServiceConfiguration(service);
  const comparisons = [
    ["serviceAccount", spec.serviceAccountName ?? spec.serviceAccount],
    ["concurrency", spec.containerConcurrency ?? spec.maxInstanceRequestConcurrency],
    ["cpu", container.resources?.limits?.cpu],
    ["memory", container.resources?.limits?.memory],
    ["network", network.network ?? spec.vpcAccess?.networkInterfaces?.[0]?.network],
    ["subnetwork", network.subnetwork ?? spec.vpcAccess?.networkInterfaces?.[0]?.subnetwork],
    ["vpcEgress", normalizedVpcEgress(annotations["run.googleapis.com/vpc-access-egress"] ?? spec.vpcAccess?.egress)],
    ["timeoutSeconds", spec.timeoutSeconds ?? (typeof spec.timeout === "string" ? Number(spec.timeout.replace(/s$/u, "")) : spec.timeout)],
    ["maxInstances", annotations["autoscaling.knative.dev/maxScale"] ?? template.scaling?.maxInstanceCount],
  ];
  for (const [name, actual] of comparisons) {
    if (Object.hasOwn(request, name) && String(actual) !== String(request[name])) throw serviceReceiptError("receipt-result-drift", `staged service ${name} differs from the exact request`);
  }
  for (const name of ["minInstances", "executionEnvironment", "cpuThrottling", "startupCpuBoost", "containerPort", "ingress"]) {
    if (Object.hasOwn(request, name) && String(extended[name]) !== String(request[name])) throw serviceReceiptError("receipt-result-drift", `staged service ${name} differs from the exact request`);
  }
  for (const [name, kind] of [["startupProbe", "startup"], ["readinessProbe", "readiness"], ["livenessProbe", "liveness"]]) {
    if (Object.hasOwn(request, name) && JSON.stringify(canonical(extended[name])) !== JSON.stringify(canonical(request[name]))) throw serviceReceiptError("receipt-result-drift", `staged service ${kind} probe differs from the exact request`);
  }
  if (request.environment !== undefined && Object.entries(request.environment).some(([name, value]) => observed[name] !== value)) throw serviceReceiptError("receipt-result-drift", "staged service environment differs from the exact request");
  if (request.secretBindings !== undefined) {
    const secrets = observedSecretBindings(service);
    if (Object.entries(request.secretBindings).some(([target, reference]) => secrets[target] !== reference)) throw serviceReceiptError("receipt-result-drift", "staged service secret references differ from the exact request");
  }
}
function serviceMatches(service, image, configuration) {
  const template = service?.spec?.template;
  const spec = template?.spec ?? {};
  const container = spec.containers?.[0] ?? {};
  const annotations = template?.metadata?.annotations ?? {};
  const network = networkInterface(service);
  return container.image === image
    && spec.containerConcurrency === configuration.concurrency
    && container.resources?.limits?.cpu === configuration.cpu
    && container.resources?.limits?.memory === configuration.memory
    && spec.serviceAccountName === configuration.serviceAccount
    && spec.timeoutSeconds === configuration.timeout
    && annotations["autoscaling.knative.dev/maxScale"] === String(configuration.maxInstances)
    && annotations["run.googleapis.com/vpc-access-egress"] === configuration.vpcEgress
    && network.network === configuration.network
    && network.subnetwork === configuration.subnetwork
    && Object.entries(configuration.environment).every(([name, value]) => environmentValues(service)[name] === value);
}
function admissionRefusal(code, detail) {
  return Object.freeze({ type: "CloudRunInvocationAdmissionRefusal", code, detail });
}
function isAdmissionRefusal(value) { return value?.type === "CloudRunInvocationAdmissionRefusal"; }
function closedInvocationAdmission(input) {
  if (Object.hasOwn(input, "allowUnauthenticated")) return admissionRefusal("legacy-allow-unauthenticated", "allowUnauthenticated is refused; supply a closed invocationAdmission record");
  const admission = input.invocationAdmission;
  if (!isObjectRecord(admission) || admission.type !== "CloudRunInvocationAdmission" || admission.closed !== true) return admissionRefusal("closed-invocation-admission-required", "a closed CloudRunInvocationAdmission record is required");
  if (admission.mode === "iap") return admissionRefusal("iap-admission-unsupported", "IAP admission is not implemented by this actuator");
  if (admission.mode === "public") {
    if (Object.keys(admission).some((key) => !["type", "mode", "closed"].includes(key))) return admissionRefusal("invalid-public-admission", "public admission is additive allUsers and accepts no removal fields");
    return Object.freeze({ ...admission });
  }
  if (admission.mode !== "named-principals") return admissionRefusal("unsupported-invocation-admission", "invocation admission mode is unsupported");
  const allowed = ["type", "mode", "closed", "principals", "exclusive", "completeOwnership"];
  if (Object.keys(admission).some((key) => !allowed.includes(key)) || !Array.isArray(admission.principals) || admission.principals.length === 0 || new Set(admission.principals).size !== admission.principals.length || admission.principals.some((member) => typeof member !== "string" || !/^(?:user|group|serviceAccount|domain):[^\s,]+$/u.test(member)) || typeof admission.exclusive !== "boolean") return admissionRefusal("invalid-named-principals-admission", "named principals must be a closed, nonempty, unique member set with explicit exclusivity");
  if (admission.exclusive === true && admission.completeOwnership !== true) return admissionRefusal("exclusive-ownership-unproven", "removal requires exclusive true and complete ownership");
  if (admission.exclusive === false && admission.completeOwnership !== undefined) return admissionRefusal("invalid-named-principals-admission", "complete ownership is meaningful only for exclusive admission");
  return Object.freeze({ ...admission, principals: Object.freeze([...admission.principals].sort()) });
}
function invocationMembers(policy) {
  return new Set((policy?.bindings ?? []).filter((binding) => binding?.role === "roles/run.invoker" && binding?.condition === undefined && Array.isArray(binding?.members)).flatMap((binding) => binding.members).filter((member) => typeof member === "string"));
}

function operationRequest(input, operation) {
  if (!isObjectRecord(input)) throw serviceReceiptError("request-invalid", `${operation} request must be an object`);
  if (input.operation !== undefined && input.operation !== operation) throw serviceReceiptError("request-operation-drift", `request operation must be ${operation}`);
}
function canonicalOriginEnvironmentBindings(value) {
  if (!Array.isArray(value) || value.length === 0 || value.some((name) => typeof name !== "string" || !/^[A-Z][A-Z0-9_]*$/u.test(name)) || new Set(value).size !== value.length) throw new Error("originEnvironmentBindings must be one nonempty unique environment-name set");
  return Object.freeze([...value].sort());
}
function projectedServiceRequest(operation, form) {
  try { return deepFreeze(form()); }
  catch (error) {
    if (error instanceof CloudRunServiceReceiptAdmissionError) throw error;
    throw serviceReceiptError("request-invalid", `${operation} request is invalid: ${error.message}`, {}, error);
  }
}

/** Project the caller's discovery request to the exact preimage used by activity(). */
export function projectCloudRunServiceDiscoveryActivityRequest(input) {
  return projectedServiceRequest("discover-cloud-run-service", () => {
    operationRequest(input, "discover-cloud-run-service");
    return cloudTarget(input);
  });
}

/** Project the full deployment request to deployCloudRunService()'s exact staging receipt preimage. */
export function projectCloudRunServiceStageActivityRequest(input) {
  return projectedServiceRequest("deploy-cloud-run-service", () => {
    operationRequest(input, "deploy-cloud-run-service");
    const target = cloudTarget(input);
    const image = immutableImage(input.image);
    const invocationAdmission = closedInvocationAdmission(input);
    if (isAdmissionRefusal(invocationAdmission)) throw serviceReceiptError("request-invalid", invocationAdmission.detail, { refusal: invocationAdmission });
    const revisionTag = input.revisionTag === undefined ? undefined : stagedRevisionTag(target, input.revisionTag);
    return { ...target, image, invocationAdmission, ...optionalServiceConfiguration(input), ...(revisionTag === undefined ? {} : { revisionTag }) };
  });
}

/** Project the caller's cutover request to the exact preimage used by activity(). */
export function projectCloudRunServiceCutoverActivityRequest(input) {
  return projectedServiceRequest("cutover-cloud-run-service", () => {
    operationRequest(input, "cutover-cloud-run-service");
    const target = cloudTarget(input);
    return { ...target, revision: requireString(input.revision, "Cloud Run revision", REVISION), canonicalOrigin: canonicalOrigin(input.canonicalOrigin), originEnvironmentBindings: canonicalOriginEnvironmentBindings(input.originEnvironmentBindings) };
  });
}

function serviceAdmission(type, operation, base, target, result) {
  return deepFreeze({
    type,
    version: 1,
    operation,
    id: base.id,
    eventId: base.receipt.id,
    contentId: identifyCanonicalJson(base.content),
    published: base.published,
    requestDigest: base.requestDigest,
    request: structuredClone(result.request),
    target: structuredClone(target),
    receipt: base.receipt,
    content: base.content,
    ...result.admitted,
  });
}

/** Admit one exact, request-bound post-operation service discovery receipt. */
export function admitCloudRunServiceDiscoveryReceipt(envelope, suppliedRequest) {
  const request = projectCloudRunServiceDiscoveryActivityRequest(suppliedRequest);
  const base = admittedServiceEnvelope(envelope, "discover-cloud-run-service", request);
  const content = base.content;
  if (!exactKeys(content, ["service", "url", "generation", "observed"]) || !sameCloudTarget(content.service, request)) throw serviceReceiptError("receipt-target-drift", "discovery receipt does not bind the requested Cloud Run service");
  const state = exactServiceResultState(content.observed, request, { label: "discovered service" });
  if (content.url !== state.origin || Number(content.generation) !== state.generation) throw serviceReceiptError("receipt-result-drift", "discovery receipt summary disagrees with its observed service state");
  return serviceAdmission("CloudRunServiceDiscoveryReceiptAdmission", "discover-cloud-run-service", base, request, {
    request,
    admitted: { generation: state.generation, origin: state.origin, revision: state.revision, traffic: structuredClone(serviceTraffic(content.observed)) },
  });
}

/** Admit one exact, request-bound no-traffic service staging receipt. */
export function admitCloudRunServiceStageReceipt(envelope, suppliedRequest) {
  const request = projectCloudRunServiceStageActivityRequest(suppliedRequest);
  const base = admittedServiceEnvelope(envelope, "stage-cloud-run-service", request);
  const content = base.content;
  const contentKeys = ["service", "image", "traffic", "revisionTag", "tagUrl", "url", "revision", "deployed"];
  if (!exactKeys(content, contentKeys) || !sameCloudTarget(content.service, request) || content.image !== request.image || content.traffic !== "none") throw serviceReceiptError("receipt-result-drift", "staging receipt does not bind the requested target, image, and no-traffic operation");
  const state = exactServiceResultState(content.deployed, request, { label: "staged service", requireImage: request.image });
  assertStagedServiceConfiguration(content.deployed, request);
  if (content.revision !== state.revision || content.url !== state.origin) throw serviceReceiptError("receipt-result-drift", "staging receipt summary disagrees with its deployed service state");
  const stagedTraffic = serviceTraffic(content.deployed);
  if (stagedTraffic.some((entry) => entry.revisionName === state.revision && Number(entry.percent ?? 0) > 0)) throw serviceReceiptError("receipt-result-drift", "staged revision already owns production traffic");
  const expectedTag = request.revisionTag ?? null;
  const tagged = expectedTag === null ? null : stagedTraffic.find((entry) => entry.tag === expectedTag && entry.revisionName === state.revision);
  if (content.revisionTag !== expectedTag || expectedTag === null && content.tagUrl !== null
    || expectedTag !== null && (!tagged || content.tagUrl !== tagged.url || exactHttpsOrigin(content.tagUrl, "staged tag origin") !== content.tagUrl)) {
    throw serviceReceiptError("receipt-result-drift", "staging receipt tag does not bind the requested staged revision route");
  }
  return serviceAdmission("CloudRunServiceStageReceiptAdmission", "stage-cloud-run-service", base, request, {
    request,
    admitted: { generation: state.generation, origin: state.origin, revision: state.revision, image: request.image, configuration: Object.fromEntries(Object.entries(request).filter(([key]) => !["project", "region", "service", "image", "invocationAdmission", "revisionTag"].includes(key))), traffic: 0, revisionTag: expectedTag, tagOrigin: content.tagUrl },
  });
}

/** Admit one exact, request-bound named-revision 100-percent cutover receipt. */
export function admitCloudRunServiceCutoverReceipt(envelope, suppliedRequest) {
  const request = projectCloudRunServiceCutoverActivityRequest(suppliedRequest);
  const base = admittedServiceEnvelope(envelope, "cutover-cloud-run-service", request);
  const content = base.content;
  const contentKeys = ["service", "revision", "canonicalOrigin", "originEnvironmentBindings", "traffic", "url", "describedRevision", "activated"];
  if (!exactKeys(content, contentKeys) || !sameCloudTarget(content.service, request) || content.revision !== request.revision
    || content.canonicalOrigin !== request.canonicalOrigin || JSON.stringify(content.originEnvironmentBindings) !== JSON.stringify(request.originEnvironmentBindings)
    || content.traffic !== 100) throw serviceReceiptError("receipt-result-drift", "cutover receipt does not bind the requested target, revision, origin bindings, and traffic operation");
  if (!revisionBelongsToService(content.describedRevision, request.service, request.revision)) throw serviceReceiptError("receipt-result-drift", "cutover receipt does not retain proof of the named revision ownership");
  const revisionEnvironment = revisionEnvironmentValues(content.describedRevision);
  if (request.originEnvironmentBindings.some((name) => revisionEnvironment[name] !== request.canonicalOrigin)) throw serviceReceiptError("receipt-result-drift", "cutover receipt does not retain the required canonical-origin environment bindings");
  const state = exactServiceResultState(content.activated, request, { label: "activated service" });
  if (content.url !== state.origin || state.revision !== request.revision) throw serviceReceiptError("receipt-result-drift", "cutover receipt summary disagrees with its activated service state");
  const positive = serviceTraffic(content.activated).filter((entry) => Number(entry.percent ?? 0) > 0);
  if (positive.length === 0 || positive.reduce((sum, entry) => sum + Number(entry.percent), 0) !== 100
    || positive.some((entry) => entry.revisionName !== request.revision || entry.latestRevision === true)) {
    throw serviceReceiptError("receipt-result-drift", "cutover result does not assign exactly 100 percent of traffic to the named revision");
  }
  return serviceAdmission("CloudRunServiceCutoverReceiptAdmission", "cutover-cloud-run-service", base, request, {
    request,
    admitted: { generation: state.generation, origin: state.origin, canonicalOrigin: request.canonicalOrigin, originEnvironmentBindings: request.originEnvironmentBindings, revision: state.revision, traffic: 100 },
  });
}

export async function discoverCloudRunDomainMapping(input, options) {
  const target = domainTarget(input);
  const raw = await gcloud(["beta", "run", "domain-mappings", "describe", "--domain", target.domain, "--project", target.project, "--region", target.region, "--format=json"], options);
  const mapping = JSON.parse(raw);
  return activity("discover-cloud-run-domain-mapping", target, { mapping: target, routeName: mappingRoute(mapping), observed: mapping });
}

export async function discoverCloudRunService(input, options) {
  const target = cloudTarget(input);
  const raw = await gcloud(["run", "services", "describe", target.service, "--project", target.project, "--region", target.region, "--format=json"], options);
  const service = JSON.parse(raw);
  return activity("discover-cloud-run-service", target, { service: target, url: service?.status?.url ?? service?.uri ?? null, generation: service?.metadata?.generation ?? service?.generation ?? null, observed: service });
}

/**
 * Retire one Cloud Run service only after a separately verified replacement
 * receiver has supplied its immutable receipt identity.  Deletion is
 * deliberately an explicit effect: a successful replacement deploy does not
 * imply that its duplicate may be removed.
 */
export async function retireCloudRunService(input, options) {
  const target = cloudTarget(input);
  if (input.confirmation !== "retire-cloud-run-duplicate") {
    throw new Error("Cloud Run retirement requires explicit retire-cloud-run-duplicate confirmation");
  }
  if (typeof input.replacementReceiptDigest !== "string" || !NI_SHA256.test(input.replacementReceiptDigest)) {
    throw new Error("Cloud Run retirement requires an ni SHA-256 replacement receipt digest");
  }
  const request = Object.freeze({ ...target, confirmation: input.confirmation, replacementReceiptDigest: input.replacementReceiptDigest });
  const before = JSON.parse(await gcloud(["run", "services", "describe", target.service, "--project", target.project, "--region", target.region, "--format=json", "--quiet"], options));
  const observedName = resourceBasename(before?.metadata?.name ?? before?.name);
  if (observedName !== target.service) throw new Error("Cloud Run retirement observation names another service");
  await gcloud(["run", "services", "delete", target.service, "--project", target.project, "--region", target.region, "--quiet"], options);
  try {
    await gcloud(["run", "services", "describe", target.service, "--project", target.project, "--region", target.region, "--format=json", "--quiet"], options);
  } catch (error) {
    if (notFound(error)) {
      return activity("retire-cloud-run-service", request, {
        service: target,
        replacementReceiptDigest: request.replacementReceiptDigest,
        prior: before,
        absent: true,
      });
    }
    throw error;
  }
  throw new Error("Cloud Run service remains discoverable after retirement request");
}

export async function deployCloudRunService(input, options) {
  const admission = closedInvocationAdmission(input);
  if (isAdmissionRefusal(admission)) return admission;
  const request = projectCloudRunServiceStageActivityRequest(input);
  const target = cloudTarget(request);
  const image = request.image;
  const args = ["run", "deploy", target.service, "--project", target.project, "--region", target.region, "--image", image, "--no-traffic", "--format=json", "--quiet"];
  const revisionTag = request.revisionTag;
  if (revisionTag !== undefined) args.push("--tag", revisionTag);
  if (request.serviceAccount !== undefined) args.push("--service-account", request.serviceAccount);
  if (request.environment !== undefined) args.push("--update-env-vars", Object.entries(request.environment).map(([name, value]) => `${name}=${value}`).join(","));
  if (request.secretBindings !== undefined) args.push("--update-secrets", Object.entries(request.secretBindings).map(([secretTarget, secret]) => `${secretTarget}=${secret}`).join(","));
  if (request.concurrency !== undefined) args.push("--concurrency", String(request.concurrency));
  if (request.cpu !== undefined) args.push("--cpu", request.cpu);
  if (request.memory !== undefined) args.push("--memory", request.memory);
  if (request.network !== undefined) args.push("--network", request.network);
  if (request.subnetwork !== undefined) args.push("--subnet", request.subnetwork);
  if (request.vpcEgress !== undefined) args.push("--vpc-egress", request.vpcEgress);
  if (request.timeoutSeconds !== undefined) args.push("--timeout", String(request.timeoutSeconds));
  if (request.maxInstances !== undefined) args.push("--max-instances", String(request.maxInstances));
  if (request.minInstances !== undefined) args.push("--min-instances", String(request.minInstances));
  if (request.executionEnvironment !== undefined) args.push("--execution-environment", request.executionEnvironment);
  if (request.cpuThrottling !== undefined) args.push(request.cpuThrottling ? "--cpu-throttling" : "--no-cpu-throttling");
  if (request.startupCpuBoost !== undefined) args.push(request.startupCpuBoost ? "--cpu-boost" : "--no-cpu-boost");
  if (request.containerPort !== undefined) args.push("--port", String(request.containerPort));
  if (request.startupProbe !== undefined) args.push("--startup-probe", probeFlag(request.startupProbe));
  if (request.readinessProbe !== undefined) args.push("--readiness-probe", probeFlag(request.readinessProbe));
  if (request.livenessProbe !== undefined) args.push("--liveness-probe", probeFlag(request.livenessProbe));
  if (request.ingress !== undefined) args.push("--ingress", request.ingress);
  if (request.deployHealthCheck !== undefined) args.push(request.deployHealthCheck ? "--deploy-health-check" : "--no-deploy-health-check");
  const raw = await gcloud(args, options);
  const service = JSON.parse(raw);
  const revision = resourceBasename(service?.status?.latestReadyRevisionName ?? service?.latestReadyRevision) ?? null;
  const tagged = revisionTag === undefined ? null : serviceTraffic(service).find((entry) => entry?.tag === revisionTag && (revision === null || entry?.revisionName === revision));
  return activity("stage-cloud-run-service", request, { service: target, image, traffic: "none", revisionTag: revisionTag ?? null, tagUrl: tagged?.url ?? null, url: service?.status?.url ?? service?.uri ?? null, revision, deployed: service });
}

// Activation is deliberately a second, named operation.  A successful build
// or ready revision cannot accidentally become production traffic as a side
// effect of staging it.
export async function cutoverCloudRunService(input, options) {
  const request = projectCloudRunServiceCutoverActivityRequest(input);
  const target = cloudTarget(request);
  const revision = request.revision;
  const origin = request.canonicalOrigin;
  const described = JSON.parse(await gcloud(["run", "revisions", "describe", revision, "--project", target.project, "--region", target.region, "--format=json"], options));
  if (!revisionBelongsToService(described, target.service, revision)) throw new Error("named Cloud Run revision is not owned by the requested service");
  const environment = revisionEnvironmentValues(described);
  if (request.originEnvironmentBindings.some((name) => environment[name] !== origin)) {
    throw new Error("named Cloud Run revision does not hold the declared canonical service origin before cutover");
  }
  const raw = await gcloud(["run", "services", "update-traffic", target.service, "--project", target.project, "--region", target.region, "--to-revisions", `${revision}=100`, "--format=json", "--quiet"], options);
  const service = JSON.parse(raw);
  return activity("cutover-cloud-run-service", request, { service: target, revision, canonicalOrigin: origin, originEnvironmentBindings: request.originEnvironmentBindings, traffic: 100, url: service?.status?.url ?? null, describedRevision: described, activated: service });
}

export async function reconcileCloudRunInvocationAdmission(input, options) {
  const admission = closedInvocationAdmission(input);
  if (isAdmissionRefusal(admission)) return admission;
  const target = cloudTarget(input);
  const policy = JSON.parse(await gcloud(["run", "services", "get-iam-policy", target.service, "--project", target.project, "--region", target.region, "--format=json"], options));
  const current = invocationMembers(policy);
  const desired = admission.mode === "public" ? ["allUsers"] : admission.principals;
  const added = []; const removed = [];
  for (const member of desired.filter((member) => !current.has(member)).sort()) {
    await gcloud(["run", "services", "add-iam-policy-binding", target.service, "--project", target.project, "--region", target.region, "--member", member, "--role", "roles/run.invoker", "--quiet"], options);
    added.push(member);
  }
  if (admission.mode === "named-principals" && admission.exclusive === true && admission.completeOwnership === true) {
    const desiredSet = new Set(desired);
    for (const member of [...current].filter((member) => !desiredSet.has(member)).sort()) {
      await gcloud(["run", "services", "remove-iam-policy-binding", target.service, "--project", target.project, "--region", target.region, "--member", member, "--role", "roles/run.invoker", "--quiet"], options);
      removed.push(member);
    }
  }
  return activity("reconcile-cloud-run-invocation-admission", { ...target, invocationAdmission: admission }, { service: target, mode: admission.mode, action: added.length === 0 && removed.length === 0 ? "unchanged" : "converged", added, removed });
}

export async function reconcileCloudRunService(input, options) {
  const admission = closedInvocationAdmission(input);
  if (isAdmissionRefusal(admission)) return admission;
  const target = domainTarget(input);
  const image = immutableImage(input.image);
  const configuration = declaredServiceConfiguration(input);
  const observedService = JSON.parse(await gcloud(["run", "services", "describe", target.service, "--project", target.project, "--region", target.region, "--format=json"], options));
  let deployment = null;
  let serviceAction = "unchanged";
  if (!serviceMatches(observedService, image, configuration)) {
    deployment = await deployCloudRunService({ ...input, ...target, image, ...configuration, invocationAdmission: admission }, options);
    serviceAction = "deployed";
  }
  const invocationAdmission = await reconcileCloudRunInvocationAdmission({ ...target, invocationAdmission: admission }, options);
  if (isAdmissionRefusal(invocationAdmission)) return invocationAdmission;
  let mapping;
  let mappingAction = "unchanged";
  try {
    mapping = JSON.parse(await gcloud(["beta", "run", "domain-mappings", "describe", "--domain", target.domain, "--project", target.project, "--region", target.region, "--format=json"], options));
  } catch (error) {
    if (!notFound(error)) throw error;
    mapping = JSON.parse(await gcloud(["beta", "run", "domain-mappings", "create", "--domain", target.domain, "--service", target.service, "--project", target.project, "--region", target.region, "--format=json", "--quiet"], options));
    mappingAction = "created";
  }
  const routeName = mappingRoute(mapping);
  if (routeName !== target.service) throw new Error(`Cloud Run domain ${target.domain} is mapped to ${routeName ?? "an unknown service"}, not ${target.service}`);
  return activity("reconcile-cloud-run-service", { ...target, image, invocationAdmission: admission, ...configuration }, {
    service: target,
    image,
    serviceAction,
    invocationAdmission: invocationAdmission.receipt.object.content,
    deployment: deployment?.receipt.object.content ?? null,
    domainMapping: { domain: target.domain, action: mappingAction, routeName, observed: mapping },
  });
}

export async function invokeCloudRunService(input, options = {}) {
  const target = cloudTarget(input);
  const description = JSON.parse(await gcloud(["run", "services", "describe", target.service, "--project", target.project, "--region", target.region, "--format=json"], options));
  const url = description?.status?.url;
  if (typeof url !== "string" || !url.startsWith("https://")) throw new Error("Cloud Run service has no HTTPS URL");
  const headers = { accept: "application/json" };
  if (input.idToken === true) headers.authorization = `Bearer ${(await gcloud(["auth", "print-identity-token"], options)).trim()}`;
  const response = await fetch(url, { method: input.method === "POST" ? "POST" : "GET", headers, body: input.method === "POST" ? JSON.stringify(input.body ?? {}) : undefined, signal: options.signal });
  const body = await response.text();
  return activity("invoke-cloud-run-service", { ...target, method: input.method ?? "GET", idToken: input.idToken === true }, { service: target, url, status: response.status, responseDigest: digest(body), responseBody: body.slice(0, 65536) });
}

export async function actuate(input, options = {}) {
  if (!isObjectRecord(input)) throw new Error("actuator request must be an object");
  switch (input.operation) {
    case "discover-cloud-run-service": return await discoverCloudRunService(input, options);
    case "retire-cloud-run-service": return await retireCloudRunService(input, options);
    case "discover-cloud-run-domain-mapping": return await discoverCloudRunDomainMapping(input, options);
    case "deploy-cloud-run-service": return await deployCloudRunService(input, options);
    case "cutover-cloud-run-service": return await cutoverCloudRunService(input, options);
    case "reconcile-cloud-run-invocation-admission": return await reconcileCloudRunInvocationAdmission(input, options);
    case "reconcile-cloud-run-service": return await reconcileCloudRunService(input, options);
    case "invoke-cloud-run-service": return await invokeCloudRunService(input, options);
    case "discover-cloud-run-job": return await discoverCloudRunJob(input, options);
    case "deploy-cloud-run-job": return await deployCloudRunJob(input, options);
    case "reconcile-cloud-run-job": return await reconcileCloudRunJob(input, options);
    case "execute-cloud-run-job": return await executeCloudRunJob(input, options);
    case "transact-cloud-run-job-image": return await transactCloudRunJobImage(input, options);
    case "wait-cloud-run-job-execution": return await waitForCloudRunJobExecution(input, options);
    default: throw new Error("unsupported GCloud actuator operation");
  }
}

export function controlPlaneDescriptor() {
  return Object.freeze({ name: "GCloud Cloud Run Actuator", description: "Local CLI and library control-plane for bounded Google Cloud Run operations.", operations: ["discover-cloud-run-service", "retire-cloud-run-service", "discover-cloud-run-domain-mapping", "deploy-cloud-run-service", "cutover-cloud-run-service", "reconcile-cloud-run-invocation-admission", "reconcile-cloud-run-service", "invoke-cloud-run-service", "discover-cloud-run-job", "deploy-cloud-run-job", "reconcile-cloud-run-job", "execute-cloud-run-job", "transact-cloud-run-job-image", "wait-cloud-run-job-execution"] });
}
