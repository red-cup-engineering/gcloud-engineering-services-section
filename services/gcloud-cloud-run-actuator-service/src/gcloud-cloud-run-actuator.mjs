import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

export const ACTOR_ID = "urn:ame:gcloud-cloud-run-actuator-service";
const SERVICE_NAME = /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/u;
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u;
const REGION = /^[a-z]+-[a-z]+[0-9]$/u;
const IMAGE = /^(?:[a-z0-9][a-z0-9._-]*\.)?[a-z0-9][a-z0-9._/-]*(?::[A-Za-z0-9._-]+|@sha256:[a-f0-9]{64})$/u;
const DIGEST_IMAGE = /@sha256:[a-f0-9]{64}$/u;
const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;
const SERVICE_ACCOUNT = /^[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\.iam|developer)\.gserviceaccount\.com$/u;
const REVISION = /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/u;
const REVISION_TAG = /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/u;

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
function immutableImage(value) {
  const image = requireString(value, "container image", IMAGE);
  if (!DIGEST_IMAGE.test(image)) throw new Error("container image must be pinned by sha256 digest");
  return image;
}
function canonicalOrigin(value) {
  let origin;
  try { origin = new URL(value); } catch { throw new Error("invalid canonical actor origin"); }
  if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password) throw new Error("canonical actor origin must be an HTTPS origin without a path");
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
function activity(operation, request, result) {
  const id = `urn:uuid:${randomUUID()}`;
  const now = new Date().toISOString();
  const receipt = { "@context": "https://www.w3.org/ns/activitystreams", id, type: "Create", actor: ACTOR_ID, published: now, object: { type: "Activity", name: operation, content: result, attributedTo: ACTOR_ID }, "union:requestDigest": digest(JSON.stringify(request)) };
  return Object.freeze({ receipt, jsonl: `${JSON.stringify(receipt)}\n` });
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
function requiredEnvironment(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid required environment");
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.some(([name, entry]) => !/^[A-Z][A-Z0-9_]*$/u.test(name) || typeof entry !== "string" || entry.includes(","))) throw new Error("invalid required environment");
  return Object.freeze(Object.fromEntries(entries));
}
function requiredSecretBindings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid Secret Manager bindings");
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.some(([target, secret]) => {
    const environment = /^[A-Z][A-Z0-9_]*$/u.test(target);
    const mount = /^\/secrets\/[a-z0-9][a-z0-9._/-]*$/u.test(target) && !target.includes("//") && !target.endsWith("/");
    return (!environment && !mount) || typeof secret !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,254}:(?:latest|[1-9][0-9]*)$/u.test(secret);
  })) throw new Error("invalid Secret Manager bindings");
  return Object.freeze(Object.fromEntries(entries));
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
function environmentValues(service) {
  return Object.fromEntries((service?.spec?.template?.spec?.containers?.[0]?.env ?? []).filter((entry) => typeof entry?.name === "string" && typeof entry?.value === "string").map((entry) => [entry.name, entry.value]));
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
function allowsPublicInvocation(policy) {
  return (policy?.bindings ?? []).some((binding) => binding?.role === "roles/run.invoker" && binding?.members?.includes("allUsers"));
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
  return activity("discover-cloud-run-service", target, { service: target, url: service?.status?.url ?? null, generation: service?.metadata?.generation ?? null, observed: service });
}

export async function deployCloudRunService(input, options) {
  const target = cloudTarget(input);
  const image = immutableImage(input.image);
  const args = ["run", "deploy", target.service, "--project", target.project, "--region", target.region, "--image", image, "--no-traffic", "--format=json", "--quiet"];
  const revisionTag = input.revisionTag === undefined ? undefined : requireString(input.revisionTag, "staged revision tag", REVISION_TAG);
  if (revisionTag !== undefined) args.push("--tag", revisionTag);
  if (input.allowUnauthenticated === true) args.push("--allow-unauthenticated");
  else args.push("--no-allow-unauthenticated");
  if (input.serviceAccount !== undefined) args.push("--service-account", requireString(input.serviceAccount, "runtime service account", SERVICE_ACCOUNT));
  if (input.environment !== undefined) args.push("--update-env-vars", Object.entries(requiredEnvironment(input.environment)).map(([name, value]) => `${name}=${value}`).join(","));
  if (input.secretBindings !== undefined) args.push("--update-secrets", Object.entries(requiredSecretBindings(input.secretBindings)).map(([target, secret]) => `${target}=${secret}`).join(","));
  if (input.concurrency !== undefined) args.push("--concurrency", String(input.concurrency));
  if (input.cpu !== undefined) args.push("--cpu", requireString(input.cpu, "Cloud Run CPU", /^[1-9][0-9]*$/u));
  if (input.memory !== undefined) args.push("--memory", requireString(input.memory, "Cloud Run memory", /^[1-9][0-9]*(?:Mi|Gi)$/u));
  if (input.network !== undefined) args.push("--network", requireString(input.network, "VPC network", /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/u));
  if (input.subnetwork !== undefined) args.push("--subnet", requireString(input.subnetwork, "VPC subnetwork", /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/u));
  if (input.vpcEgress !== undefined) args.push("--vpc-egress", requireString(input.vpcEgress, "VPC egress", /^(?:private-ranges-only|all-traffic)$/u));
  if (input.timeoutSeconds !== undefined) args.push("--timeout", String(input.timeoutSeconds));
  if (input.maxInstances !== undefined) args.push("--max-instances", String(input.maxInstances));
  const raw = await gcloud(args, options);
  const service = JSON.parse(raw);
  const revision = service?.status?.latestReadyRevisionName ?? null;
  const tagged = revisionTag === undefined ? null : (service?.status?.traffic ?? []).find((entry) => entry?.tag === revisionTag && (revision === null || entry?.revisionName === revision));
  return activity("stage-cloud-run-service", { ...target, image, allowUnauthenticated: input.allowUnauthenticated === true, ...(revisionTag === undefined ? {} : { revisionTag }) }, { service: target, image, traffic: "none", revisionTag: revisionTag ?? null, tagUrl: tagged?.url ?? null, url: service?.status?.url ?? null, revision, deployed: service });
}

// Activation is deliberately a second, named operation.  A successful build
// or ready revision cannot accidentally become production traffic as a side
// effect of staging it.
export async function cutoverCloudRunService(input, options) {
  const target = cloudTarget(input);
  const revision = requireString(input.revision, "Cloud Run revision", REVISION);
  const origin = canonicalOrigin(input.canonicalOrigin);
  const described = JSON.parse(await gcloud(["run", "revisions", "describe", revision, "--project", target.project, "--region", target.region, "--format=json"], options));
  if (!revisionBelongsToService(described, target.service, revision)) throw new Error("named Cloud Run revision is not owned by the requested service");
  const environment = revisionEnvironmentValues(described);
  if (environment.BASE_URL !== origin || environment.ACTIVITYPUB_ORIGIN !== origin) {
    throw new Error("named Cloud Run revision does not hold the declared canonical actor origin before cutover");
  }
  const raw = await gcloud(["run", "services", "update-traffic", target.service, "--project", target.project, "--region", target.region, "--to-revisions", `${revision}=100`, "--format=json", "--quiet"], options);
  const service = JSON.parse(raw);
  return activity("cutover-cloud-run-service", { ...target, revision, canonicalOrigin: origin }, { service: target, revision, canonicalOrigin: origin, traffic: 100, url: service?.status?.url ?? null, activated: service });
}

export async function reconcileCloudRunService(input, options) {
  const target = domainTarget(input);
  const image = immutableImage(input.image);
  const configuration = declaredServiceConfiguration(input);
  const observedService = JSON.parse(await gcloud(["run", "services", "describe", target.service, "--project", target.project, "--region", target.region, "--format=json"], options));
  const policy = JSON.parse(await gcloud(["run", "services", "get-iam-policy", target.service, "--project", target.project, "--region", target.region, "--format=json"], options));
  let deployment = null;
  let serviceAction = "unchanged";
  if (!serviceMatches(observedService, image, configuration)) {
    deployment = await deployCloudRunService({ ...input, ...target, image, ...configuration, allowUnauthenticated: true }, options);
    serviceAction = "deployed";
  }
  let publicInvocationAction = "unchanged";
  if (!allowsPublicInvocation(policy)) {
    await gcloud(["run", "services", "add-iam-policy-binding", target.service, "--project", target.project, "--region", target.region, "--member", "allUsers", "--role", "roles/run.invoker", "--quiet"], options);
    publicInvocationAction = "granted";
  }
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
  return activity("reconcile-cloud-run-service", { ...target, image, allowUnauthenticated: true, ...configuration }, {
    service: target,
    image,
    serviceAction,
    publicInvocationAction,
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
  if (!input || typeof input !== "object") throw new Error("actuator request must be an object");
  switch (input.operation) {
    case "discover-cloud-run-service": return await discoverCloudRunService(input, options);
    case "discover-cloud-run-domain-mapping": return await discoverCloudRunDomainMapping(input, options);
    case "deploy-cloud-run-service": return await deployCloudRunService(input, options);
    case "cutover-cloud-run-service": return await cutoverCloudRunService(input, options);
    case "reconcile-cloud-run-service": return await reconcileCloudRunService(input, options);
    case "invoke-cloud-run-service": return await invokeCloudRunService(input, options);
    default: throw new Error("unsupported GCloud actuator operation");
  }
}

export function controlPlaneDescriptor() {
  return Object.freeze({ name: "GCloud Cloud Run Actuator", description: "Local CLI and library control-plane for bounded Google Cloud Run operations.", operations: ["discover-cloud-run-service", "discover-cloud-run-domain-mapping", "deploy-cloud-run-service", "cutover-cloud-run-service", "reconcile-cloud-run-service", "invoke-cloud-run-service"] });
}
