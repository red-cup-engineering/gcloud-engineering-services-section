import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { identifyDeploymentRecord } from "@red-cup-engineering/deployment-formation-contracts/canonical-record";

const MANIFEST = "context-manifest.json";
const SHA256 = /^[a-f0-9]{64}$/u;

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function digestOf(record) {
  const value = identifyDeploymentRecord(record).slice("ni:///sha-256;".length);
  return `sha256:${Buffer.from(value, "base64url").toString("hex")}`;
}

export function admitNodeRuntimeReleaseCatalogReceipt(receipt) {
  if (receipt?.type !== "NodeRuntimeReleaseCatalogReceipt" || receipt.version !== 1 || !Array.isArray(receipt.entries) || receipt.entries.length === 0 || !SHA256.test(receipt.digest ?? "")) throw new TypeError("runtime catalog must be one NodeRuntimeReleaseCatalogReceipt v1");
  const ids = new Set();
  for (const entry of receipt.entries) {
    if (typeof entry?.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(entry.id) || ids.has(entry.id)) throw new TypeError("runtime catalog entries require unique filesystem-safe identities");
    ids.add(entry.id);
    if (!SHA256.test(entry.artifactDigest ?? "") || entry.releaseRelativePath !== `../../releases/${entry.artifactDigest}`) throw new TypeError(`runtime catalog entry ${entry.id} is not digest-bound`);
  }
  const body = { type: receipt.type, version: receipt.version, entries: receipt.entries };
  if (sha256(JSON.stringify(body)) !== receipt.digest) throw new TypeError("runtime catalog receipt digest is invalid");
  return Object.freeze({ type: receipt.type, version: receipt.version, entries: receipt.entries, digest: receipt.digest });
}

export async function inspectCloudBuildImageContext(contextDirectory) {
  const root = await realpath(contextDirectory), files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = join(directory, entry.name), path = relative(root, absolute).split(sep).join("/");
      if (path === MANIFEST) continue;
      if (entry.isDirectory()) { await visit(absolute); continue; }
      const info = await lstat(absolute);
      if (info.isSymbolicLink() || !info.isFile()) throw new TypeError(`Cloud Build context contains a non-regular carrier: ${path}`);
      const bytes = await readFile(absolute);
      files.push({ path, bytes: bytes.byteLength, sha256: sha256(bytes) });
    }
  }
  await visit(root);
  return Object.freeze(files);
}

export function formCloudBuildImageContextManifest({ files, runtimeReleaseCatalogReceipt }) {
  const catalog = admitNodeRuntimeReleaseCatalogReceipt(runtimeReleaseCatalogReceipt);
  if (!Array.isArray(files) || files.some((entry) => typeof entry?.path !== "string" || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !SHA256.test(entry.sha256 ?? ""))) throw new TypeError("context files must be exact path, byte-count, and SHA-256 records");
  const ordered = [...files].sort((left, right) => left.path.localeCompare(right.path));
  if (new Set(ordered.map(({ path }) => path)).size !== ordered.length) throw new TypeError("context file paths must be unique");
  const content = { type: "CloudBuildImageContextManifest", version: 1, runtimeReleaseCatalogDigest: catalog.digest, files: ordered };
  return Object.freeze({ ...content, digest: digestOf(content) });
}

export async function createCloudBuildImageContextManifest({ contextDirectory, runtimeReleaseCatalogReceipt }) {
  return formCloudBuildImageContextManifest({ files: await inspectCloudBuildImageContext(contextDirectory), runtimeReleaseCatalogReceipt });
}

export async function admitCloudBuildImageContext({ contextDirectory, manifest, runtimeReleaseCatalogReceipt }) {
  const supplied = typeof manifest === "string" ? JSON.parse(manifest) : manifest;
  const expected = await createCloudBuildImageContextManifest({ contextDirectory, runtimeReleaseCatalogReceipt });
  if (JSON.stringify(supplied) !== JSON.stringify(expected)) throw new TypeError("Cloud Build context disagrees with its canonical manifest or runtime release catalog");
  return Object.freeze({ type: "CloudBuildImageContextAdmission", version: 1, contextDigest: expected.digest, files: expected.files.length, runtimeReleaseCatalogDigest: expected.runtimeReleaseCatalogDigest });
}
