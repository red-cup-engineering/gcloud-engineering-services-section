import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { admitCloudBuildImageFabricationReceipt, fabricateCloudBuildImage, persistCloudBuildImageReceipt } from "../src/gcloud-cloud-build-image-fabrication.mjs";
import { createCloudBuildImageContextManifest } from "../src/context-manifest.mjs";

const sourceSha = "c".repeat(40);
const digest = `sha256:${"a".repeat(64)}`;
const contextDirectory = await mkdtemp(join(tmpdir(), "cloud-build-fabricator-"));
await writeFile(join(contextDirectory, "Dockerfile"), "FROM scratch\n");
const catalogBody = { type: "NodeRuntimeReleaseCatalogReceipt", version: 1, entries: [{ id: "application", entryPackage: "fixture", entryVersion: "1.0.0", entryCarrier: "src/index.mjs", artifactDigest: "f".repeat(64), releaseRelativePath: `../../releases/${"f".repeat(64)}` }] };
const runtimeReleaseCatalogReceipt = { ...catalogBody, digest: createHash("sha256").update(JSON.stringify(catalogBody)).digest("hex") };
const contextManifest = await createCloudBuildImageContextManifest({ contextDirectory, runtimeReleaseCatalogReceipt });
after(() => rm(contextDirectory, { recursive: true, force: true }));
const input = {
  project: "five-six-one-group-dev",
  contextDirectory,
  cloudBuildConfig: join(contextDirectory, "cloudbuild.yaml"),
  contextManifest,
  runtimeReleaseCatalogReceipt,
  image: `us-central1-docker.pkg.dev/five-six-one-group-dev/union/wuxian-gui:${sourceSha}`,
  buildServiceAccount: "youtube-image-builder@five-six-one-group-dev.iam.gserviceaccount.com",
  sourceSha,
  packageGraphDigest: `sha256:${"d".repeat(64)}`,
};

function successfulBuild(overrides = {}) {
  return JSON.stringify({
    id: "build-123",
    status: "SUCCESS",
    createTime: "2096-01-01T00:00:00Z",
    finishTime: "2096-01-01T00:01:00Z",
    source: { storageSource: { bucket: "build-source", object: "source.tgz", generation: "7" } },
    sourceProvenance: { resolvedStorageSource: { bucket: "build-source", object: "source.tgz", generation: "7" } },
    results: { images: [{ name: input.image, digest }] },
    ...overrides,
  });
}

test("fabrication binds source, package graph, context, build, and registry to one digest", async () => {
  const calls = [];
  const value = await fabricateCloudBuildImage(input, { gcloud: async (args) => {
    calls.push(args);
    return args[0] === "artifacts" ? JSON.stringify([{ tags: [sourceSha], version: digest }]) : successfulBuild();
  } });
  assert.equal(calls[0][0], "builds");
  assert.equal(calls[1][0], "artifacts");
  assert.equal(value.object.content.sourceSha, sourceSha);
  assert.equal(value.object.content.contextDigest, contextManifest.digest);
  assert.equal(value.object.content.runtimeReleaseCatalogDigest, `sha256:${runtimeReleaseCatalogReceipt.digest}`);
  assert.equal(value.object.content.packageGraphDigest, input.packageGraphDigest);
  assert.equal(value.object.content.build.id, "build-123");
  assert.match(value.object.content.image, /@sha256:a{64}$/u);
  assert.equal(JSON.stringify(value).includes(contextDirectory), false);
  assert.equal(admitCloudBuildImageFabricationReceipt(value).content, value.object.content);
});

test("fabrication refuses a config outside its declared context before effects", async () => {
  await assert.rejects(fabricateCloudBuildImage({ ...input, cloudBuildConfig: join(contextDirectory, "../other.yaml") }, { gcloud: async () => { throw new Error("effect"); } }), /inside one declared/u);
});

test("fabrication refuses a moving or mismatched source tag", async () => {
  await assert.rejects(fabricateCloudBuildImage({ ...input, image: "us-central1-docker.pkg.dev/five-six-one-group-dev/union/wuxian-gui:latest" }, { gcloud: async () => { throw new Error("effect"); } }), /tag must equal/u);
});

test("fabrication refuses a failed build before consulting the registry", async () => {
  const calls = [];
  await assert.rejects(fabricateCloudBuildImage(input, { gcloud: async (args) => { calls.push(args); return successfulBuild({ status: "FAILURE" }); } }), /successful witnessed build/u);
  assert.equal(calls.length, 1);
});

test("fabrication refuses disagreement between build result and registry", async () => {
  await assert.rejects(fabricateCloudBuildImage(input, { gcloud: async (args) => args[0] === "artifacts" ? JSON.stringify([{ tags: [sourceSha], version: `sha256:${"e".repeat(64)}` }]) : successfulBuild() }), /does not agree/u);
});

test("fabrication refuses a build authority from another project", async () => {
  await assert.rejects(fabricateCloudBuildImage({ ...input, buildServiceAccount: "youtube-image-builder@another-project.iam.gserviceaccount.com" }, { gcloud: async () => { throw new Error("effect"); } }), /project disagrees/u);
});

test("immutable custody is explicit, create-only, and generation-qualified", async () => {
  const receipt = { type: "Create" }, calls = [];
  const custody = await persistCloudBuildImageReceipt(receipt, "gs://evidence/control-plane/builds/one.json", { evidenceStore: { async create(object, body) { calls.push({ object, body }); return { uri: "gs://evidence/control-plane/builds/one.json#7", digest: "sha256:x" }; } } });
  assert.deepEqual(calls, [{ object: "control-plane/builds/one.json", body: receipt }]);
  assert.equal(custody.uri.endsWith("#7"), true);
  await assert.rejects(persistCloudBuildImageReceipt(receipt, "gs://evidence/control-plane/builds/two.json", { evidenceStore: { async create() { return { uri: "gs://evidence/control-plane/builds/two.json" }; } } }), /exact created generation/u);
});

test("receipt admission refuses owner, request, runtime-catalog, artifact, and verification drift", async () => {
  const value = await fabricateCloudBuildImage(input, { gcloud: async (args) => args[0] === "artifacts" ? JSON.stringify([{ tags: [sourceSha], version: digest }]) : successfulBuild() });
  const mutations = [
    { ...structuredClone(value), actor: "urn:foreign" },
    { ...structuredClone(value), "union:requestDigest": `sha256:${"0".repeat(64)}` },
    structuredClone(value), structuredClone(value), structuredClone(value),
  ];
  delete mutations[2].object.content.runtimeReleaseCatalogDigest;
  mutations[3].object.content.digest = `sha256:${"e".repeat(64)}`;
  mutations[4].object.content.verification = "claimed";
  for (const mutation of mutations) assert.throws(() => admitCloudBuildImageFabricationReceipt(mutation), /fabrication receipt|runtime release catalog|immutable project-bound|successful independent|canonical request/u);
});
