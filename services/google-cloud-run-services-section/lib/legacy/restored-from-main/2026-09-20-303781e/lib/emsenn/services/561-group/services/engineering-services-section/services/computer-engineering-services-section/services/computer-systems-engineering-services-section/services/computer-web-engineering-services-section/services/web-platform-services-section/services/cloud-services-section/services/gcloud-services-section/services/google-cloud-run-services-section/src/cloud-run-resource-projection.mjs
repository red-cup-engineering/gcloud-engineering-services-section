import { createHash } from "node:crypto";
import { admitCloudRunServiceStageReceipt } from "@red-cup-engineering/gcloud-cloud-run-actuator-service";
import { isObjectRecord } from "../../../../../../../../../../../../computer-data-engineering-services-section/services/serialized-computer-data-engineering-services-section/services/json-services-section/src/index.mjs";
import observedRecord from "../content/resources/notebooklm-inference-team.observed.json" with { type: "json" };
import desiredRecord from "../content/resources/notebooklm-inference-team.desired.json" with { type: "json" };

const RESOURCE = "urn:561-group:cloud-run-service:notebooklm-inference-team";
const RESOURCE_ID = /^urn:561-group:cloud-run-service:[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/u;
const PROJECT = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u;
const REGION = /^[a-z]+-[a-z]+[0-9]$/u;
const SERVICE = /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/u;
const REVISION = /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/u;
const DIGEST_IMAGE = /@sha256:[a-f0-9]{64}$/u;
const SERVICE_ACCOUNT = /^[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\.iam|developer)\.gserviceaccount\.com$/u;
const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;
const ENVIRONMENT_NAME = /^[A-Z][A-Z0-9_]*$/u;
const SECRET_REFERENCE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,254}:(?:latest|[1-9][0-9]*)$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const CONTENT_ID = /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u;
const SEMVER = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const ABSOLUTE_PATH = /^\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/u;
const BASE_IMAGE = /^node:[0-9]+\.[0-9]+\.[0-9]+-[a-z0-9]+@sha256:[a-f0-9]{64}$/u;
const OCI_REFERENCE = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\/[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*@sha256:[a-f0-9]{64}$/u;

function clone(value) { return structuredClone(value); }
function canonical(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObjectRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  throw new TypeError("projection values must be finite JSON records");
}
function contentId(value) { return `ni:///sha-256;${createHash("sha256").update(canonical(value)).digest("base64url")}`; }
function exactKeys(value, keys) {
  return isObjectRecord(value) && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}
function validTarget(value) {
  return exactKeys(value, ["project", "region", "service"])
    && PROJECT.test(value.project) && REGION.test(value.region) && SERVICE.test(value.service);
}
function sameTarget(left, right) {
  return left.project === right.project && left.region === right.region && left.service === right.service;
}
function httpsOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.pathname === "/" && !url.search && !url.hash
      && !url.username && !url.password && url.origin === value;
  } catch { return false; }
}
function httpsBelow(value, origin) {
  try { const url = new URL(value); return url.protocol === "https:" && url.origin === origin; }
  catch { return false; }
}
function refusal(operation, code, missing, detail) {
  return Object.freeze({
    type: "GoogleCloudRunResourceProjectionRefusal",
    operation,
    code,
    missing: Object.freeze([...missing].sort()),
    detail,
  });
}
function isRefusal(value) { return value?.type === "GoogleCloudRunResourceProjectionRefusal"; }
function requireRecord(value, type, label) {
  if (!isObjectRecord(value) || value.type !== type) throw new TypeError(`${label} is not a ${type}`);
  return value;
}
function validSecretTarget(target) {
  return ENVIRONMENT_NAME.test(target) || /^\/secrets\/[a-z0-9][a-z0-9._/-]*$/u.test(target) && !target.includes("//") && !target.endsWith("/");
}
function admitNetworkAttachment(value) {
  if (exactKeys(value, ["mode"]) && value.mode === "none") return value;
  if (exactKeys(value, ["mode", "network", "subnetwork", "vpcEgress"]) && value.mode === "direct-vpc"
    && SERVICE.test(value.network ?? "") && SERVICE.test(value.subnetwork ?? "")
    && ["private-ranges-only", "all-traffic"].includes(value.vpcEgress)) return value;
  throw new TypeError("runtime networkAttachment must be provider-default none or one exact direct VPC attachment");
}
function admitHttpProbe(value, kind) {
  const readiness = kind === "readiness";
  const keys = readiness ? ["httpGet", "timeoutSeconds", "periodSeconds", "failureThreshold", "successThreshold"] : ["httpGet", "initialDelaySeconds", "timeoutSeconds", "periodSeconds", "failureThreshold"];
  if (!exactKeys(value, keys) || !exactKeys(value.httpGet, ["path", "port"]) || !/^\/(?:[A-Za-z0-9._~!$&'()*+;=:@%-]+\/?)*$/u.test(value.httpGet.path ?? "") || !Number.isInteger(value.httpGet.port) || value.httpGet.port < 1 || value.httpGet.port > 65_535) throw new TypeError(`runtime ${kind} probe is invalid`);
  const integer = (name, minimum) => Number.isInteger(value[name]) && value[name] >= minimum && value[name] <= 240;
  if ((!readiness && !integer("initialDelaySeconds", 0)) || !integer("timeoutSeconds", 1) || !integer("periodSeconds", 1) || !integer("failureThreshold", 1) || readiness && !integer("successThreshold", 1) || value.timeoutSeconds > value.periodSeconds) throw new TypeError(`runtime ${kind} probe bounds are invalid`);
  return value;
}
function admitAuthoritySelections(value) {
  if (!exactKeys(value, ["node", "debian", "python", "identity", "paths", "network", "shutdown"])) throw new TypeError("image construction authority selections are not closed");
  if (!exactKeys(value.node, ["version", "baseImage"]) || !SEMVER.test(value.node.version ?? "") || !BASE_IMAGE.test(value.node.baseImage ?? "")) throw new TypeError("image construction Node selection is invalid");
  if (!exactKeys(value.debian, ["suite", "snapshot", "architecture", "packageRequests"]) || !/^[a-z0-9]+$/u.test(value.debian.suite ?? "") || !/^\d{8}T\d{6}Z$/u.test(value.debian.snapshot ?? "") || !["amd64", "arm64"].includes(value.debian.architecture) || !Array.isArray(value.debian.packageRequests) || value.debian.packageRequests.length === 0) throw new TypeError("image construction Debian selection is invalid");
  if (value.debian.packageRequests.some((entry) => !exactKeys(entry, ["name", "version"]) || !/^[a-z0-9][a-z0-9+.-]*$/u.test(entry.name ?? "") || typeof entry.version !== "string" || !/^[A-Za-z0-9][A-Za-z0-9.+:~_-]*$/u.test(entry.version)) || new Set(value.debian.packageRequests.map(({ name }) => name)).size !== value.debian.packageRequests.length || value.debian.packageRequests.map(({ name }) => name).join("\0") !== value.debian.packageRequests.map(({ name }) => name).sort().join("\0")) throw new TypeError("image construction Debian packages are invalid or non-canonical");
  if (!exactKeys(value.python, ["version", "venv"]) || !SEMVER.test(value.python.version ?? "") || !ABSOLUTE_PATH.test(value.python.venv ?? "")) throw new TypeError("image construction Python selection is invalid");
  if (!exactKeys(value.identity, ["uid", "gid"]) || ![value.identity.uid, value.identity.gid].every((entry) => Number.isSafeInteger(entry) && entry > 0)) throw new TypeError("image construction identity is invalid");
  if (!exactKeys(value.paths, ["app", "writable", "temporary"]) || !Object.values(value.paths).every((entry) => ABSOLUTE_PATH.test(entry ?? ""))) throw new TypeError("image construction paths are invalid");
  if (!exactKeys(value.network, ["port"]) || !Number.isInteger(value.network.port) || value.network.port < 1 || value.network.port > 65_535) throw new TypeError("image construction port is invalid");
  if (!exactKeys(value.shutdown, ["timeoutSeconds"]) || !Number.isInteger(value.shutdown.timeoutSeconds) || value.shutdown.timeoutSeconds < 1 || value.shutdown.timeoutSeconds > 60) throw new TypeError("image construction shutdown selection is invalid");
  return value;
}
function admitImageConstruction(value) {
  requireRecord(value, "GoogleCloudRunNodeRuntimeImageConstructionDeclaration", "image construction declaration");
  if (!exactKeys(value, ["type", "version", "status", "providerSelection", "providerRequirement", "releaseEvidence", "ociImageObservation", "ociSelection", "authoritySelections", "unresolved"])) throw new TypeError("image construction declaration contains undeclared fields");
  if (value.version !== 1 || !["partial", "declared"].includes(value.status) || !Array.isArray(value.unresolved) || value.unresolved.some((entry) => typeof entry !== "string" || entry === "")) throw new TypeError("image construction declaration state is invalid");
  const oci = value.ociSelection;
  if (!exactKeys(oci, ["requestedReference", "platform", "tagIndexDigest", "selectedManifestDigest", "configDigest"]) || !OCI_REFERENCE.test(oci.requestedReference ?? "") || !exactKeys(oci.platform, ["os", "architecture"]) || oci.platform.os !== "linux" || !["amd64", "arm64"].includes(oci.platform.architecture) || ![oci.tagIndexDigest, oci.selectedManifestDigest, oci.configDigest].every((digest) => SHA256.test(digest ?? "")) || !oci.requestedReference.endsWith(`@${oci.tagIndexDigest}`)) throw new TypeError("image construction OCI selection is invalid");
  const selections = admitAuthoritySelections(value.authoritySelections);
  if (!selections.node.baseImage.endsWith(`@${oci.selectedManifestDigest}`) || selections.debian.architecture !== oci.platform.architecture) throw new TypeError("image construction authority and OCI selections disagree");
  const provider = value.providerSelection;
  if (!exactKeys(provider, ["package", "requirementsLock"]) || !exactKeys(provider.package, ["name", "version"]) || provider.package.name !== "@red-cup-engineering/notebooklm-services-section" || provider.package.version !== "0.3.7" || !exactKeys(provider.requirementsLock, ["path", "sha256", "installation"]) || provider.requirementsLock.path !== "requirements.lock" || provider.requirementsLock.sha256 !== "sha256:781d2674dcdd42bd95c1aad64500deaf2d961175ebc0c12489f552985166b9ec" || provider.requirementsLock.installation !== "require-hashes") throw new TypeError("image construction provider selection is invalid");
  return value;
}
function admitObserved(value) {
  requireRecord(value, "GoogleCloudRunProviderDeploymentDeclaration", "observed declaration");
  if (value.version !== 1 || !RESOURCE_ID.test(value.resource ?? "") || !validTarget(value.target)) throw new TypeError("observed declaration has an invalid resource identity");
  requireRecord(value.revision, "GoogleCloudRunRevisionDeclaration", "observed revision");
  if (!REVISION.test(value.revision.name ?? "")) throw new TypeError("observed revision name is invalid");
  requireRecord(value.endpoint, "GoogleCloudRunEndpointDeclaration", "observed endpoint");
  if (!httpsOrigin(value.endpoint.providerAssignedOrigin)
    || ![value.endpoint.actor, value.endpoint.inbox, value.endpoint.outbox].every((url) => httpsBelow(url, value.endpoint.providerAssignedOrigin))) {
    throw new TypeError("observed endpoints do not share one HTTPS provider origin");
  }
  if (value.evidence?.kind !== "provider-authored-checked-in-declaration"
    || typeof value.evidence.source !== "string" || Number.isNaN(Date.parse(value.evidence.declaredAt))) {
    throw new TypeError("observed declaration must name its checked-in evidence");
  }
  return value;
}
function admitDesired(value) {
  requireRecord(value, "GoogleCloudRunDesiredServiceProjection", "desired projection");
  if (value.version !== 1 || !RESOURCE_ID.test(value.resource ?? "") || !validTarget(value.target)) throw new TypeError("desired projection has an invalid resource identity");
  requireRecord(value.image, "GoogleCloudRunImageDeclaration", "image declaration");
  admitImageConstruction(value.imageConstruction);
  requireRecord(value.revision, "GoogleCloudRunRevisionDeclaration", "revision declaration");
  requireRecord(value.staging, "GoogleCloudRunStagingRouteDeclaration", "staging route declaration");
  requireRecord(value.environment, "GoogleCloudRunEnvironmentDeclaration", "environment declaration");
  requireRecord(value.secretBindings, "GoogleCloudRunSecretBindingsDeclaration", "secret bindings declaration");
  requireRecord(value.invocationAdmission, "GoogleCloudRunInvocationAdmissionDeclaration", "invocation admission declaration");
  requireRecord(value.runtime, "GoogleCloudRunRuntimeDeclaration", "runtime declaration");
  requireRecord(value.traffic, "GoogleCloudRunTrafficDeclaration", "traffic declaration");
  requireRecord(value.domain, "GoogleCloudRunDomainDeclaration", "domain declaration");
  if (!exactKeys(value.staging, ["type", "status", "revisionTag"]) || value.staging.status !== "declared"
    || !SERVICE.test(value.staging.revisionTag ?? "")) throw new TypeError("staging route declaration is invalid");
  if (!exactKeys(value.environment, ["type", "status", "values", "unresolved"]) || !["partial", "declared"].includes(value.environment.status)) throw new TypeError("environment declaration shape is invalid");
  if (!isObjectRecord(value.environment.values) || Object.entries(value.environment.values).some(([name, entry]) => !ENVIRONMENT_NAME.test(name) || typeof entry !== "string" || entry.includes(","))) throw new TypeError("environment declaration contains an invalid value");
  if (!Array.isArray(value.environment.unresolved) || value.environment.unresolved.some((name) => !ENVIRONMENT_NAME.test(name))) throw new TypeError("environment unresolved bindings are invalid");
  if (!exactKeys(value.secretBindings, ["type", "status", "values", "unresolved"]) || !["partial", "declared"].includes(value.secretBindings.status)) throw new TypeError("Secret Manager declaration shape is invalid");
  if (!isObjectRecord(value.secretBindings.values) || Object.entries(value.secretBindings.values).some(([target, reference]) => !validSecretTarget(target) || !SECRET_REFERENCE.test(reference))) throw new TypeError("declared Secret Manager references are invalid");
  if (!Array.isArray(value.secretBindings.unresolved) || value.secretBindings.unresolved.some((entry) => !exactKeys(entry, ["name", "target", "delivery"]) || !ENVIRONMENT_NAME.test(entry.name ?? "") || !validSecretTarget(entry.target ?? "") || entry.delivery !== "read-only-file")) throw new TypeError("unresolved Secret Manager bindings are invalid");
  if (!exactKeys(value.runtime, ["type", "status", "concurrency", "cpu", "memory", "serviceAccount", "networkAttachment", "timeoutSeconds", "maxInstances", "minInstances", "executionEnvironment", "cpuThrottling", "startupCpuBoost", "containerPort", "startupProbe", "readinessProbe", "livenessProbe", "ingress", "deployHealthCheck"]) || value.runtime.status !== "declared") throw new TypeError("runtime declaration contains undeclared fields or is not closed");
  if (!exactKeys(value.invocationAdmission, ["type", "status", "value", "rationale"]) || value.invocationAdmission.status !== "declared" || value.invocationAdmission.value?.type !== "CloudRunInvocationAdmission" || value.invocationAdmission.value.mode !== "public" || value.invocationAdmission.value.closed !== true || typeof value.invocationAdmission.rationale !== "string" || value.invocationAdmission.rationale === "") throw new TypeError("NotebookLM invocation admission must be a closed public declaration");
  admitNetworkAttachment(value.runtime.networkAttachment);
  if (!Number.isInteger(value.runtime.minInstances) || value.runtime.minInstances < 0 || value.runtime.minInstances > value.runtime.maxInstances || !["gen1", "gen2"].includes(value.runtime.executionEnvironment) || typeof value.runtime.cpuThrottling !== "boolean" || typeof value.runtime.startupCpuBoost !== "boolean" || !Number.isInteger(value.runtime.containerPort) || value.runtime.containerPort < 1 || value.runtime.containerPort > 65_535 || !["all", "internal", "internal-and-cloud-load-balancing"].includes(value.runtime.ingress) || typeof value.runtime.deployHealthCheck !== "boolean") throw new TypeError("extended runtime declaration is invalid");
  for (const [probe, kind] of [[value.runtime.startupProbe, "startup"], [value.runtime.readinessProbe, "readiness"], [value.runtime.livenessProbe, "liveness"]]) {
    admitHttpProbe(probe, kind);
    if (probe.httpGet.port !== value.runtime.containerPort || probe.httpGet.path !== "/healthz") throw new TypeError(`runtime ${kind} probe must target the selected provider health endpoint`);
  }
  if (!httpsOrigin(value.domain.canonicalOrigin) || value.domain.customDomain !== null && !DOMAIN.test(value.domain.customDomain)) throw new TypeError("domain declaration is invalid");
  return value;
}

export function loadCloudRunResourceInstance() {
  const observed = admitObserved(clone(observedRecord));
  const desired = admitDesired(clone(desiredRecord));
  return formCloudRunResourceInstance({ observed, desired });
}

export function formCloudRunResourceInstance({ observed, desired } = {}) {
  admitObserved(observed); admitDesired(desired);
  if (observed.resource !== desired.resource || !sameTarget(observed.target, desired.target)) throw new TypeError("observed and desired records name different Cloud Run resources");
  return Object.freeze({ type: "GoogleCloudRunResourceInstance", resource: observed.resource, observed: clone(observed), desired: clone(desired) });
}

function resource(value) {
  if (value?.type !== "GoogleCloudRunResourceInstance" || !RESOURCE_ID.test(value.resource ?? "")) throw new TypeError("Cloud Run resource instance is required");
  admitObserved(value.observed); admitDesired(value.desired);
  if (value.resource !== value.observed.resource || value.resource !== value.desired.resource || !sameTarget(value.observed.target, value.desired.target)) throw new TypeError("resource instance target differs between observed and desired records");
  return value;
}

function admitSelectedOciImageObservation(value, construction) {
  if (!isObjectRecord(value) || value.type !== "OciImageObservation" || value.version !== 1 || value.status !== "observed" || !Array.isArray(value.effects) || value.effects.length !== 0 || !CONTENT_ID.test(value.id ?? "")) throw new TypeError("OCI image observation is not one effect-free content-addressed observation");
  const body = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "id"));
  if (contentId(body) !== value.id) throw new TypeError("OCI image observation content identity is invalid");
  const selected = construction.ociSelection;
  if (value.reference !== selected.requestedReference || value.requestedDigest !== selected.tagIndexDigest || value.index?.digest !== selected.tagIndexDigest || value.manifest?.digest !== selected.selectedManifestDigest || value.config?.digest !== selected.configDigest || value.platform?.os !== selected.platform.os || value.platform?.architecture !== selected.platform.architecture || value.config?.os !== selected.platform.os || value.config?.architecture !== selected.platform.architecture || value.node?.status !== "observed" || value.node.version !== construction.authoritySelections.node.version || value.debian?.status !== "observed" || value.debian.suite !== construction.authoritySelections.debian.suite || !Array.isArray(value.unresolved) || value.unresolved.length !== 0) throw new TypeError("OCI image observation does not match the selected image");
  const occupied = value.finalRootfs?.occupied?.union;
  if (!exactKeys(occupied, ["uids", "gids"]) || ![occupied.uids, occupied.gids].every((members) => Array.isArray(members) && members.every((entry) => Number.isSafeInteger(entry) && entry >= 0) && new Set(members).size === members.length && members.every((entry, index) => index === 0 || members[index - 1] < entry))) throw new TypeError("OCI image occupied identities are invalid or non-canonical");
  return value;
}
function admitProviderCompositionInputs(value, releaseEvidence, selection) {
  if (!isObjectRecord(value)) throw new TypeError("provider requirement owner output is required");
  const provider = value.providerContract;
  if (provider?.package?.name !== selection.package.name || provider.package.version !== selection.package.version || canonical(provider.requirementsLock) !== canonical(selection.requirementsLock)) throw new TypeError("provider requirement does not match the selected package contract");
  if (!exactKeys(releaseEvidence, ["providerCatalog", "runtimeReleaseCatalogReceipt", "verificationObservation"]) || ![releaseEvidence.providerCatalog, releaseEvidence.runtimeReleaseCatalogReceipt, releaseEvidence.verificationObservation].every(isObjectRecord)) throw new TypeError("provider release owner outputs are required");
  return { value, releaseEvidence };
}

export function projectNodeRuntimeContainerImageConstructionInput(value, evidence = {}) {
  const instance = resource(value);
  const construction = instance.desired.imageConstruction;
  const providerRequirement = evidence.providerRequirement ?? construction.providerRequirement;
  const releaseEvidence = evidence.releaseEvidence ?? construction.releaseEvidence;
  const ociImageObservation = evidence.ociImageObservation ?? construction.ociImageObservation;
  const missing = [];
  if (providerRequirement === null || providerRequirement === undefined) missing.push("providerRequirement");
  if (releaseEvidence === null || releaseEvidence === undefined) missing.push("providerReleaseEvidence");
  if (ociImageObservation === null || ociImageObservation === undefined) missing.push("ociImageObservation");
  if (missing.length) return refusal("project-node-runtime-container-image-construction-input", "image-construction-evidence-open", missing, "image construction requires provider release evidence and an OCI image observation");
  admitProviderCompositionInputs(providerRequirement, releaseEvidence, construction.providerSelection);
  admitSelectedOciImageObservation(ociImageObservation, construction);
  return Object.freeze({
    type: "GoogleCloudRunNodeRuntimeImageConstructionInputProjection",
    version: 1,
    resource: instance.resource,
    target: clone(instance.desired.target),
    providerRequirement: clone(providerRequirement),
    releaseEvidence: clone(releaseEvidence),
    ociImageObservation: clone(ociImageObservation),
    authoritySelections: clone(construction.authoritySelections),
  });
}

export function formCloudRunServiceDiscoveryRequest(value) {
  const instance = resource(value);
  return Object.freeze({ operation: "discover-cloud-run-service", ...instance.desired.target });
}

export function projectCloudRunServiceObservation(value, actuatorReceipt) {
  const instance = resource(value);
  const receipt = actuatorReceipt?.receipt;
  const content = receipt?.object?.content;
  if (receipt?.actor !== "urn:ame:gcloud-cloud-run-actuator-service" || receipt?.object?.name !== "discover-cloud-run-service"
    || !isObjectRecord(content) || !sameTarget(content.service ?? {}, instance.desired.target) || !isObjectRecord(content.observed)) {
    throw new TypeError("Cloud Run discovery receipt does not observe the declared resource");
  }
  if (content.url !== null && (typeof content.url !== "string" || !httpsOrigin(content.url))) throw new TypeError("Cloud Run discovery receipt has an invalid provider URL");
  if (content.generation !== null && (!Number.isInteger(Number(content.generation)) || Number(content.generation) < 0)) throw new TypeError("Cloud Run discovery receipt has an invalid generation");
  if (Number.isNaN(Date.parse(receipt.published))) throw new TypeError("Cloud Run discovery receipt has no observation time");
  const revision = content.observed?.status?.latestReadyRevisionName ?? null;
  if (revision !== null && !REVISION.test(revision)) throw new TypeError("Cloud Run discovery receipt carries an invalid ready revision");
  return Object.freeze({
    type: "GoogleCloudRunServiceObservation",
    resource: instance.resource,
    target: clone(instance.desired.target),
    observedAt: receipt.published,
    generation: content.generation === null ? null : Number(content.generation),
    url: content.url,
    revision,
    declaredComparison: Object.freeze({
      urlMatches: content.url !== null && content.url === instance.observed.endpoint.providerAssignedOrigin,
      revisionMatches: revision === instance.observed.revision.name,
    }),
    providerState: clone(content.observed),
  });
}

function deploymentFields(desired) {
  const missing = [];
  if (desired.image.status !== "declared" || !DIGEST_IMAGE.test(desired.image.value ?? "")) missing.push("image");
  if (desired.imageConstruction.status !== "declared" || desired.imageConstruction.unresolved.length !== 0 || [desired.imageConstruction.providerRequirement, desired.imageConstruction.releaseEvidence, desired.imageConstruction.ociImageObservation].some((entry) => entry === null)) missing.push("imageConstruction");
  else {
    try { admitProviderCompositionInputs(desired.imageConstruction.providerRequirement, desired.imageConstruction.releaseEvidence, desired.imageConstruction.providerSelection); admitSelectedOciImageObservation(desired.imageConstruction.ociImageObservation, desired.imageConstruction); }
    catch { missing.push("imageConstruction"); }
  }
  if (desired.environment.status !== "declared" || desired.environment.unresolved.length !== 0) missing.push("environment");
  const secrets = desired.secretBindings;
  if (secrets.status !== "declared" || secrets.unresolved.length !== 0 || !isObjectRecord(secrets.values) || Object.keys(secrets.values).length === 0
    || Object.entries(secrets.values).some(([target, reference]) => {
      return !validSecretTarget(target) || !SECRET_REFERENCE.test(reference);
    })) missing.push("secretBindings");
  const admission = desired.invocationAdmission.value;
  const publicAdmission = exactKeys(admission, ["type", "mode", "closed"]) && admission?.mode === "public";
  const namedAdmission = exactKeys(admission, ["type", "mode", "closed", "principals", "exclusive"])
    && admission?.mode === "named-principals" && Array.isArray(admission.principals) && admission.principals.length > 0
    && new Set(admission.principals).size === admission.principals.length
    && admission.principals.every((member) => /^(?:user|group|serviceAccount|domain):[^\s,]+$/u.test(member)) && admission.exclusive === false;
  const exclusiveAdmission = exactKeys(admission, ["type", "mode", "closed", "principals", "exclusive", "completeOwnership"])
    && admission?.mode === "named-principals" && Array.isArray(admission.principals) && admission.principals.length > 0
    && new Set(admission.principals).size === admission.principals.length
    && admission.principals.every((member) => /^(?:user|group|serviceAccount|domain):[^\s,]+$/u.test(member))
    && admission.exclusive === true && admission.completeOwnership === true;
  if (desired.invocationAdmission.status !== "declared" || !isObjectRecord(admission) || admission.type !== "CloudRunInvocationAdmission" || admission.closed !== true || !publicAdmission && !namedAdmission && !exclusiveAdmission) missing.push("invocationAdmission");
  const runtime = desired.runtime;
  if (runtime.status !== "declared" || !Number.isInteger(runtime.concurrency) || runtime.concurrency < 1
    || !/^[1-9][0-9]*$/u.test(runtime.cpu ?? "") || !/^[1-9][0-9]*(?:Mi|Gi)$/u.test(runtime.memory ?? "")
    || !SERVICE_ACCOUNT.test(runtime.serviceAccount ?? "")
    || !Number.isInteger(runtime.timeoutSeconds) || runtime.timeoutSeconds < 1 || runtime.timeoutSeconds > 3600
    || !Number.isInteger(runtime.maxInstances) || runtime.maxInstances < 1 || runtime.maxInstances > 1000
    || runtime.concurrency > 1000) missing.push("runtime");
  if (desired.staging.status !== "declared" || !SERVICE.test(desired.staging.revisionTag ?? "")) missing.push("staging");
  return missing;
}

export function formCloudRunServiceDeploymentRequest(value) {
  const desired = resource(value).desired;
  const missing = deploymentFields(desired);
  if (missing.length) return refusal("deploy-cloud-run-service", "desired-projection-open", missing, "required deployment fields are not yet filled in");
  const network = desired.runtime.networkAttachment.mode === "none" ? {} : {
    network: desired.runtime.networkAttachment.network,
    subnetwork: desired.runtime.networkAttachment.subnetwork,
    vpcEgress: desired.runtime.networkAttachment.vpcEgress,
  };
  return Object.freeze({
    operation: "deploy-cloud-run-service",
    ...clone(desired.target),
    image: desired.image.value,
    revisionTag: desired.staging.revisionTag,
    environment: Object.fromEntries(Object.entries(desired.environment.values).sort(([left], [right]) => left.localeCompare(right))),
    secretBindings: Object.fromEntries(Object.entries(desired.secretBindings.values).sort(([left], [right]) => left.localeCompare(right))),
    invocationAdmission: clone(desired.invocationAdmission.value),
    concurrency: desired.runtime.concurrency,
    cpu: desired.runtime.cpu,
    memory: desired.runtime.memory,
    serviceAccount: desired.runtime.serviceAccount,
    ...network,
    timeoutSeconds: desired.runtime.timeoutSeconds,
    maxInstances: desired.runtime.maxInstances,
    minInstances: desired.runtime.minInstances,
    executionEnvironment: desired.runtime.executionEnvironment,
    cpuThrottling: desired.runtime.cpuThrottling,
    startupCpuBoost: desired.runtime.startupCpuBoost,
    containerPort: desired.runtime.containerPort,
    startupProbe: clone(desired.runtime.startupProbe),
    readinessProbe: clone(desired.runtime.readinessProbe),
    livenessProbe: clone(desired.runtime.livenessProbe),
    ingress: desired.runtime.ingress,
    deployHealthCheck: desired.runtime.deployHealthCheck,
  });
}

/**
 * Project one actuator-admitted, tagged, zero-traffic stage into the machine
 * observation consumed by independent application observers.
 */
export function projectStagedCloudRunServiceObservation(value, actuatorStageReceipt) {
  const instance = resource(value);
  const request = formCloudRunServiceDeploymentRequest(instance);
  if (isRefusal(request)) throw new TypeError("the staged deployment request is not complete");
  const stage = admitCloudRunServiceStageReceipt(actuatorStageReceipt, request);
  if (stage.traffic !== 0 || stage.revisionTag !== instance.desired.staging.revisionTag
    || !httpsOrigin(stage.tagOrigin) || !DIGEST_IMAGE.test(stage.image ?? "")
    || !sameTarget(stage.target, instance.desired.target)) {
    throw new TypeError("the admitted stage does not expose the exact tagged zero-traffic machine revision");
  }
  return Object.freeze({
    type: "GoogleCloudRunServiceObservation",
    phase: "staged-no-traffic",
    resource: instance.resource,
    target: clone(stage.target),
    observedAt: stage.published,
    generation: stage.generation,
    revision: stage.revision,
    url: stage.tagOrigin,
    serviceOrigin: stage.origin,
    image: stage.image,
    traffic: 0,
    stageReceipt: stage.id,
    stageEventId: stage.eventId,
    stageRequestDigest: stage.requestDigest,
    providerState: clone(stage.content.deployed),
  });
}

function validOriginEnvironmentBindings(value) {
  return Array.isArray(value) && value.length > 0 && value.every((name) => ENVIRONMENT_NAME.test(name)) && new Set(value).size === value.length;
}

export function formCloudRunServiceCutoverRequest(value, originEnvironmentBindings) {
  const desired = resource(value).desired;
  const deployment = formCloudRunServiceDeploymentRequest(value);
  if (isRefusal(deployment)) return refusal("cutover-cloud-run-service", "deployment-projection-open", deployment.missing, "cutover cannot close before the deployment projection");
  const missing = [];
  if (desired.revision.status !== "declared" || !REVISION.test(desired.revision.name ?? "")) missing.push("revision");
  if (desired.traffic.status !== "admitted" || desired.traffic.percent !== 100 || desired.traffic.revision !== desired.revision.name) missing.push("traffic");
  if (!httpsOrigin(desired.domain.canonicalOrigin)) missing.push("domain");
  if (!validOriginEnvironmentBindings(originEnvironmentBindings)) missing.push("originEnvironmentBindings");
  if (missing.length) return refusal("cutover-cloud-run-service", "cutover-gate-open", missing, "the named revision, explicit 100 percent traffic admission, and this deployment's origin environment bindings are required");
  return Object.freeze({ operation: "cutover-cloud-run-service", ...clone(desired.target), revision: desired.revision.name, canonicalOrigin: desired.domain.canonicalOrigin, originEnvironmentBindings: Object.freeze([...originEnvironmentBindings]) });
}

export const NOTEBOOKLM_CLOUD_RUN_RESOURCE = RESOURCE;
