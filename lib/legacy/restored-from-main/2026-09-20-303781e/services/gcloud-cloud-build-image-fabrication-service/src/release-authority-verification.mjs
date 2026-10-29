import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { isObjectRecord } from "../../../../../../../../../../../../computer-data-engineering-services-section/services/serialized-computer-data-engineering-services-section/services/json-services-section/src/index.mjs";

// CommonJS resolution intentionally honors NODE_PATH.  Release workflows use
// that to provide this one public, exact-lock parser dependency before any
// cloud credential exists, without installing this package's private runtime
// dependency graph.
const { parseDocument } = createRequire(import.meta.url)("yaml");

const SHA = /^[a-f0-9]{40}$/u;
const DIGEST_IMAGE = /^.+@sha256:[a-f0-9]{64}$/u;
const EXPLICIT_BUILDER_IMAGE = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[1-9][0-9]{0,4})?\/[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*@sha256:[a-f0-9]{64}$/u;
const SAFE_RELATIVE_PATH = /^[A-Za-z0-9._/-]+$/u;

function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function safeRelativePath(value) {
  return typeof value === "string" && SAFE_RELATIVE_PATH.test(value) && !value.startsWith("/")
    && !value.split("/").some((segment) => ["", ".", ".."].includes(segment));
}

function yamlValue(source, label) {
  const document = parseDocument(source, { version: "1.2", uniqueKeys: true, prettyErrors: false });
  if (document.errors.length) return { errors: document.errors.map((error) => `${label}: invalid YAML 1.2: ${error.code ?? error.message}`) };
  try { return { value: document.toJS({ maxAliasCount: 0 }), errors: [] }; }
  catch (error) { return { errors: [`${label}: YAML aliases are not admitted: ${error.message}`] }; }
}

export function workflowAuthorityViolations(source, authority, label = "workflow") {
  const parsed = yamlValue(source, label); if (parsed.errors.length) return parsed.errors;
  const defects = [], jobs = parsed.value?.jobs;
  if (!isObjectRecord(jobs) || Object.keys(jobs).length === 0) return [`${label}: jobs must be one non-empty mapping`];
  for (const [jobName, job] of Object.entries(jobs)) {
    if (!isObjectRecord(job)) { defects.push(`${label}: job ${jobName} must be a mapping`); continue; }
    if (job["runs-on"] !== authority.runner) defects.push(`${label}: job ${jobName} runner is not ${authority.runner}`);
    if (!Array.isArray(job.steps)) { defects.push(`${label}: job ${jobName} steps must be a sequence`); continue; }
    let nodeReady = false, setupNodeCount = 0;
    for (const [index, step] of job.steps.entries()) {
      if (!isObjectRecord(step)) { defects.push(`${label}: job ${jobName} step ${index} must be a mapping`); continue; }
      if (typeof step.run === "string" && /^(?!\s*#).*\bnode(?:\s|$)/mu.test(step.run) && !nodeReady) defects.push(`${label}: job ${jobName} step ${index} invokes Node before its admitted setup-node authority`);
      if (!Object.hasOwn(step, "uses")) continue;
      if (typeof step.uses !== "string") { defects.push(`${label}: job ${jobName} step ${index} uses must be one literal`); continue; }
      const at = step.uses.lastIndexOf("@"), action = step.uses.slice(0, at), revision = step.uses.slice(at + 1);
      if (at <= 0 || !SHA.test(revision)) { defects.push(`${label}: action ${step.uses} is not pinned to one commit`); continue; }
      const admitted = authority.actions?.[action];
      if (!admitted) { defects.push(`${label}: action ${action} has no admitted authority`); continue; }
      if (revision !== admitted.revision) defects.push(`${label}: action ${action} revision ${revision} disagrees with authority`);
      let inputsAgree = true;
      for (const [name, expected] of Object.entries(admitted.inputs ?? {})) if (step.with?.[name] !== expected) { inputsAgree = false; defects.push(`${label}: action ${action} input ${name} is not ${expected}`); }
      if (action === "actions/setup-node") {
        setupNodeCount += 1;
        if (revision === admitted.revision && inputsAgree) nodeReady = true;
      }
    }
    if (setupNodeCount !== 1) defects.push(`${label}: job ${jobName} must contain exactly one admitted setup-node step`);
  }
  return defects;
}

export function cloudBuildAuthorityViolations(source, authority, label = "Cloud Build config") {
  const parsed = yamlValue(source, label); if (parsed.errors.length) return parsed.errors;
  const defects = [], config = parsed.value, dockerfilePath = authority.cloudBuild.dockerfilePath ?? "Dockerfile";
  if (authority.cloudBuild.imageSubstitution !== "${_IMAGE}") defects.push(`${label}: image substitution authority must be exactly \${_IMAGE}`);
  if (!safeRelativePath(dockerfilePath)) defects.push(`${label}: Dockerfile path is not one safe substitution-free POSIX-relative path`);
  const expectedArgs = ["build", "--pull", ...(dockerfilePath === "Dockerfile" ? [] : ["--file", dockerfilePath]), "--tag", "${_IMAGE}", "."];
  if (!isObjectRecord(config) || !same(Object.keys(config).sort(), ["images", "options", "steps"])) return [`${label}: top-level structure must contain exactly steps, images, and options`];
  if (!Array.isArray(config.steps) || config.steps.length === 0) defects.push(`${label}: steps must be one non-empty sequence`);
  else for (const [index, step] of config.steps.entries()) {
    if (!isObjectRecord(step) || typeof step.name !== "string" || !EXPLICIT_BUILDER_IMAGE.test(step.name) || !authority.cloudBuild.builders.includes(step.name)) defects.push(`${label}: step ${index} builder is not one admitted explicit-registry digest`);
    if (!same(step?.args, expectedArgs)) defects.push(`${label}: step ${index} arguments disagree with the admitted image build and Dockerfile path`);
    if (!isObjectRecord(step) || !same(Object.keys(step).sort(), ["args", "name"])) defects.push(`${label}: step ${index} contains an unadmitted field`);
  }
  if (!same(config.images, ["${_IMAGE}"])) defects.push(`${label}: images must contain exactly the fixed \${_IMAGE} substitution`);
  if (!isObjectRecord(config.options) || !same(Object.keys(config.options).sort(), ["logging", "requestedVerifyOption"]) || config.options.logging !== "CLOUD_LOGGING_ONLY" || config.options.requestedVerifyOption !== "VERIFIED") defects.push(`${label}: options must require verified provenance and Cloud Logging only`);
  return defects;
}

export function dockerfileAuthorityViolations(source, authority, label = "Dockerfile") {
  const defects = [];
  const bases = [...source.matchAll(/^FROM\s+([^\s]+)(?:\s+AS\s+\S+)?\s*$/gimu)].map((match) => match[1]);
  if (bases.length === 0) defects.push(`${label}: no base image found`);
  for (const base of bases) {
    if (!DIGEST_IMAGE.test(base)) defects.push(`${label}: base ${base} is not digest pinned`);
    else if (!authority.docker.bases.includes(base)) defects.push(`${label}: base ${base} disagrees with authority`);
  }
  return defects;
}

/** Inspect every declared release authority from one immutable, machine-readable policy. */
export function releaseAuthorityViolations(sourceRoot, authority) {
  if (authority?.type !== "EmswebCloudReleaseAuthority" || authority.version !== 1) throw new TypeError("unsupported cloud release authority");
  const root = resolve(sourceRoot), defects = [];
  for (const path of authority.workflows ?? []) defects.push(...workflowAuthorityViolations(readFileSync(resolve(root, path), "utf8"), authority, path));
  const configuredDockerfile = authority.cloudBuild.dockerfilePath ?? "Dockerfile";
  const contextDockerfile = authority.docker.contextPath ?? authority.docker.path;
  if (!safeRelativePath(contextDockerfile)) defects.push(`Release authority Dockerfile context path ${contextDockerfile} is not one safe substitution-free POSIX-relative path`);
  if (configuredDockerfile !== contextDockerfile) defects.push(`Cloud Build Dockerfile path ${configuredDockerfile} disagrees with release authority Dockerfile context path ${contextDockerfile}`);
  defects.push(...cloudBuildAuthorityViolations(readFileSync(resolve(root, authority.cloudBuild.path), "utf8"), authority, authority.cloudBuild.path));
  defects.push(...dockerfileAuthorityViolations(readFileSync(resolve(root, authority.docker.path), "utf8"), authority, authority.docker.path));
  return defects;
}
