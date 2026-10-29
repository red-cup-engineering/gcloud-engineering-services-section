import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { identifyDeploymentRecord } from "@red-cup-engineering/deployment-formation-contracts/canonical-record";
import { admitCloudBuildImageContext } from "./context-manifest.mjs";

export const ACTOR = "urn:ame:gcloud-cloud-build-image-fabrication-service";
const PROJECT = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u;
const IMAGE = /^[a-z]+-[a-z]+[0-9]-docker\.pkg\.dev\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*:[A-Za-z0-9._-]+$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SOURCE_SHA = /^[a-f0-9]{40}$/u;
const SERVICE_ACCOUNT = /^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/u;

function exact(value, label, pattern) {
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(`invalid ${label}`);
  return value;
}

function canonicalRequestDigest(request) {
  const identity = identifyDeploymentRecord(request).slice("ni:///sha-256;".length);
  return `sha256:${Buffer.from(identity, "base64url").toString("hex")}`;
}

function receipt(request, content) {
  return Object.freeze({
    "@context": "https://www.w3.org/ns/activitystreams",
    id: `urn:uuid:${randomUUID()}`,
    type: "Create",
    actor: ACTOR,
    published: new Date().toISOString(),
    object: { type: "Activity", name: "fabricate-cloud-build-image", content },
    "union:requestDigest": canonicalRequestDigest(request),
  });
}

function buildImage(build, image) {
  const rows = build?.results?.images;
  if (!Array.isArray(rows)) return null;
  return rows.find((row) => row?.name === image || row?.name === image.slice(0, image.lastIndexOf(":"))) ?? null;
}

/** Admits only this owner's closed, canonically request-bound fabrication receipt. */
export function admitCloudBuildImageFabricationReceipt(value) {
  if (value?.type !== "Create" || value.actor !== ACTOR || value.object?.type !== "Activity" || value.object?.name !== "fabricate-cloud-build-image") throw new TypeError("value is not a Cloud Build image fabrication receipt");
  const content = value.object.content;
  const project = exact(content?.project, "receipt Google Cloud project", PROJECT);
  const sourceSha = exact(content?.sourceSha, "receipt source Git object ID", SOURCE_SHA);
  const digest = exact(content?.digest, "receipt immutable image digest", DIGEST);
  const immutableImage = content?.image;
  if (typeof immutableImage !== "string" || !immutableImage.endsWith(`@${digest}`) || !immutableImage.includes(`/${project}/`)) throw new TypeError("fabrication receipt image is not an immutable project-bound digest");
  const taggedImage = immutableImage.slice(0, immutableImage.lastIndexOf("@")) + `:${sourceSha}`;
  exact(taggedImage, "receipt requested image", IMAGE);
  const contextDigest = exact(content.contextDigest, "receipt context digest", DIGEST);
  const runtimeReleaseCatalogDigest = exact(content.runtimeReleaseCatalogDigest, "receipt runtime release catalog digest", DIGEST);
  const packageGraphDigest = content.packageGraphDigest === null ? null : exact(content.packageGraphDigest, "receipt package graph digest", DIGEST);
  const buildServiceAccount = content.buildServiceAccount === null ? null : exact(content.buildServiceAccount, "receipt build service account", SERVICE_ACCOUNT);
  if (buildServiceAccount !== null && !buildServiceAccount.endsWith(`@${project}.iam.gserviceaccount.com`)) throw new TypeError("fabrication receipt build authority belongs to another project");
  if (content.build?.status !== "SUCCESS" || typeof content.build.id !== "string" || content.build.id.length === 0 || content.verification !== "cloud-build-result-and-artifact-registry-agree") throw new TypeError("fabrication receipt lacks successful independent digest verification");
  const request = { project, image: taggedImage, sourceSha, contextDigest, runtimeReleaseCatalogDigest, packageGraphDigest, buildServiceAccount };
  const requestDigest = canonicalRequestDigest(request);
  if (value["union:requestDigest"] !== requestDigest) throw new TypeError("fabrication receipt canonical request digest is invalid");
  return Object.freeze({ type: "CloudBuildImageFabricationAdmission", version: 1, receipt: value, content: Object.freeze(content), request: Object.freeze(request), requestDigest });
}

/** Builds one admitted context and returns its independently verified immutable image identity. */
export async function fabricateCloudBuildImage(input, { gcloud } = {}) {
  const project = exact(input?.project, "Google Cloud project", PROJECT);
  const image = exact(input?.image, "target Artifact Registry image tag", IMAGE);
  const sourceSha = exact(input?.sourceSha, "source Git object ID", SOURCE_SHA);
  const contextAdmission = await admitCloudBuildImageContext({ contextDirectory: input?.contextDirectory, manifest: input?.contextManifest, runtimeReleaseCatalogReceipt: input?.runtimeReleaseCatalogReceipt });
  const contextDigest = exact(contextAdmission.contextDigest, "build context digest", DIGEST);
  const runtimeReleaseCatalogDigest = exact(`sha256:${contextAdmission.runtimeReleaseCatalogDigest}`, "runtime release catalog digest", DIGEST);
  const packageGraphDigest = input?.packageGraphDigest === undefined ? null : exact(input.packageGraphDigest, "package graph digest", DIGEST);
  const buildServiceAccount = input?.buildServiceAccount === undefined ? null : exact(input.buildServiceAccount, "Cloud Build service account", SERVICE_ACCOUNT);
  if (!image.includes(`/${project}/`)) throw new Error("target image project disagrees with requested Google Cloud project");
  if (!image.endsWith(`:${sourceSha}`)) throw new Error("target image tag must equal the admitted source Git object ID");
  if (buildServiceAccount !== null && !buildServiceAccount.endsWith(`@${project}.iam.gserviceaccount.com`)) throw new Error("Cloud Build service account project disagrees with requested Google Cloud project");
  const contextDirectory = resolve(String(input?.contextDirectory ?? ""));
  const cloudBuildConfig = resolve(String(input?.cloudBuildConfig ?? ""));
  if (!contextDirectory || contextDirectory === "/" || !cloudBuildConfig.startsWith(`${contextDirectory}/`)) throw new Error("Cloud Build config must be inside one declared non-root context directory");
  if (typeof gcloud !== "function") throw new Error("bounded gcloud executor is required");

  const build = JSON.parse(await gcloud([
    "builds", "submit", contextDirectory,
    "--project", project,
    "--config", cloudBuildConfig,
    ...(buildServiceAccount === null ? [] : ["--service-account", buildServiceAccount]),
    "--substitutions", `_IMAGE=${image}`,
    "--format=json", "--quiet",
  ]));
  if (build?.status !== "SUCCESS" || typeof build?.id !== "string" || build.id.length === 0) throw new Error("Cloud Build did not return one successful witnessed build");
  const produced = buildImage(build, image);
  const buildDigest = produced?.digest;
  if (!DIGEST.test(buildDigest ?? "")) throw new Error("Cloud Build result does not bind the requested image to an immutable digest");

  const repository = image.slice(0, image.lastIndexOf(":"));
  const tag = image.slice(image.lastIndexOf(":") + 1);
  const listed = JSON.parse(await gcloud(["artifacts", "docker", "images", "list", repository, "--project", project, "--include-tags", "--format=json", "--quiet"]));
  const row = Array.isArray(listed) ? listed.find((entry) => Array.isArray(entry.tags) && entry.tags.includes(tag)) : null;
  const registryDigest = row?.version ?? row?.digest;
  if (!DIGEST.test(registryDigest ?? "") || registryDigest !== buildDigest) throw new Error("Artifact Registry digest does not agree with the Cloud Build result");

  const semanticRequest = { project, image, sourceSha, contextDigest, runtimeReleaseCatalogDigest, packageGraphDigest, buildServiceAccount };
  return receipt(semanticRequest, {
    ...semanticRequest,
    image: `${repository}@${registryDigest}`,
    digest: registryDigest,
    build: {
      id: build.id,
      status: build.status,
      createTime: build.createTime ?? null,
      finishTime: build.finishTime ?? null,
      source: build.source ?? null,
      sourceProvenance: build.sourceProvenance ?? null,
    },
    verification: "cloud-build-result-and-artifact-registry-agree",
  });
}

/** Optionally closes durable custody without granting the fabricator an ambient storage authority. */
export async function persistCloudBuildImageReceipt(receipt, destination, { evidenceStore } = {}) {
  if (typeof destination !== "string" || !/^gs:\/\/[a-z0-9][a-z0-9._-]+\/[A-Za-z0-9._/-]+$/u.test(destination)) throw new TypeError("fabrication receipt destination must be one unqualified GCS object URI");
  if (typeof evidenceStore?.create !== "function") throw new TypeError("immutable evidence store must provide create(object, body)");
  const slash = destination.indexOf("/", 5), object = destination.slice(slash + 1);
  const retained = await evidenceStore.create(object, receipt);
  if (typeof retained?.uri !== "string" || !retained.uri.startsWith(`${destination}#`) || !/#[1-9][0-9]*$/u.test(retained.uri)) throw new Error("immutable evidence store did not return the exact created generation");
  return Object.freeze({ type: "CloudBuildImageFabricationReceiptCustody", version: 1, uri: retained.uri, digest: retained.digest ?? null });
}
