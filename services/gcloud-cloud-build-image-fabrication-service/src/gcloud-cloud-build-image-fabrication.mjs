import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";

export const ACTOR = "urn:ame:gcloud-cloud-build-image-fabrication-service";
const PROJECT = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u;
const IMAGE = /^[a-z]+-[a-z]+[0-9]-docker\.pkg\.dev\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*:[A-Za-z0-9._-]+$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
function exact(value, label, pattern) { if (typeof value !== "string" || !pattern.test(value)) throw new Error(`invalid ${label}`); return value; }
function receipt(request, content) { const digest = createHash("sha256").update(JSON.stringify(request)).digest("hex"); return Object.freeze({ "@context":"https://www.w3.org/ns/activitystreams", id:`urn:uuid:${randomUUID()}`, type:"Create", actor:ACTOR, published:new Date().toISOString(), object:{ type:"Activity", name:"fabricate-cloud-build-image", content }, "union:requestDigest":`sha256:${digest}` }); }

/** Builds one declared context and returns only its verified immutable image identity. */
export async function fabricateCloudBuildImage(input, { gcloud } = {}) {
  const project = exact(input?.project, "Google Cloud project", PROJECT);
  const image = exact(input?.image, "target Artifact Registry image tag", IMAGE);
  if (!image.includes(`/${project}/`)) throw new Error("target image project disagrees with requested Google Cloud project");
  const contextDirectory = resolve(String(input?.contextDirectory ?? ""));
  const cloudBuildConfig = resolve(String(input?.cloudBuildConfig ?? ""));
  if (!contextDirectory || contextDirectory === "/" || !cloudBuildConfig.startsWith(`${contextDirectory}/`)) throw new Error("Cloud Build config must be inside one declared non-root context directory");
  if (typeof gcloud !== "function") throw new Error("bounded gcloud executor is required");
  await gcloud(["builds","submit",contextDirectory,"--project",project,"--config",cloudBuildConfig,"--substitutions",`_IMAGE=${image}`,"--format=json","--quiet"]);
  const listed = JSON.parse(await gcloud(["artifacts","docker","images","list",image.slice(0, image.lastIndexOf(":")),"--project",project,"--include-tags","--format=json","--quiet"]));
  const row = Array.isArray(listed) ? listed.find((entry) => Array.isArray(entry.tags) && entry.tags.includes(image.slice(image.lastIndexOf(":") + 1))) : null;
  const digest = row?.version ?? row?.digest;
  if (!DIGEST.test(digest ?? "")) throw new Error("Cloud Build completed without a verifiable immutable Artifact Registry digest");
  return receipt({ project, contextDirectory, cloudBuildConfig, image }, { project, image: `${image.slice(0, image.lastIndexOf(":"))}@${digest}`, digest, contextDirectory, cloudBuildConfig, build: "submitted-and-registry-verified" });
}
