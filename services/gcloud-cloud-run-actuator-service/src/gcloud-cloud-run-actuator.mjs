import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

export const ACTOR_ID = "urn:ame:gcloud-cloud-run-actuator-service";
const SERVICE_NAME = /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/u;
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u;
const REGION = /^[a-z]+-[a-z]+[0-9]$/u;
const IMAGE = /^(?:[a-z0-9][a-z0-9._-]*\.)?[a-z0-9][a-z0-9._/-]*(?::[A-Za-z0-9._-]+|@sha256:[a-f0-9]{64})$/u;

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
function gcloud(args, { env = process.env, cwd } = {}) {
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

export async function discoverCloudRunService(input, options) {
  const target = cloudTarget(input);
  const raw = await gcloud(["run", "services", "describe", target.service, "--project", target.project, "--region", target.region, "--format=json"], options);
  const service = JSON.parse(raw);
  return activity("discover-cloud-run-service", target, { service: target, url: service?.status?.url ?? null, generation: service?.metadata?.generation ?? null, observed: service });
}

export async function deployCloudRunService(input, options) {
  const target = cloudTarget(input);
  const image = requireString(input.image, "container image", IMAGE);
  const args = ["run", "deploy", target.service, "--project", target.project, "--region", target.region, "--image", image, "--format=json", "--quiet"];
  if (input.allowUnauthenticated === true) args.push("--allow-unauthenticated");
  else args.push("--no-allow-unauthenticated");
  if (input.serviceAccount !== undefined) args.push("--service-account", requireString(input.serviceAccount, "runtime service account", /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.iam\.gserviceaccount\.com$/u));
  const raw = await gcloud(args, options);
  const service = JSON.parse(raw);
  return activity("deploy-cloud-run-service", { ...target, image, allowUnauthenticated: input.allowUnauthenticated === true }, { service: target, image, url: service?.status?.url ?? null, revision: service?.status?.latestReadyRevisionName ?? null, deployed: service });
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
    case "deploy-cloud-run-service": return await deployCloudRunService(input, options);
    case "invoke-cloud-run-service": return await invokeCloudRunService(input, options);
    default: throw new Error("unsupported GCloud actuator operation");
  }
}

export function agentCard(baseUrl) {
  const base = new URL(baseUrl).href.replace(/\/$/u, "");
  return { name: "GCloud Cloud Run Actuator", description: "Union actor for bounded, real Cloud Run operations through gcloud.", version: "1.0.0", protocolVersion: "1.0", url: `${base}/a2a`, preferredTransport: "JSONRPC", supportedInterfaces: [{ url: `${base}/a2a`, protocolBinding: "JSONRPC" }], provider: { organization: "Red Cup Engineering", url: base }, capabilities: { streaming: false, pushNotifications: false, extensions: [{ uri: "urn:ame:activitypub-jsonl-outbox", required: false }] }, skills: ["discover-cloud-run-service", "deploy-cloud-run-service", "invoke-cloud-run-service"].map((id) => ({ id, name: id, description: `Bounded ${id} operation.` })) };
}
