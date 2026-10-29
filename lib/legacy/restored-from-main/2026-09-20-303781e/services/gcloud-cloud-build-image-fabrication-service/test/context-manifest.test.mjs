import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { admitCloudBuildImageContext, createCloudBuildImageContextManifest } from "../src/context-manifest.mjs";

function catalog() {
  const body = { type: "NodeRuntimeReleaseCatalogReceipt", version: 1, entries: [{ id: "daily", artifactDigest: "a".repeat(64), releaseRelativePath: `../../releases/${"a".repeat(64)}` }] };
  return { ...body, digest: createHash("sha256").update(JSON.stringify(body)).digest("hex") };
}

test("context admission binds exact carrier bytes to the native runtime catalog receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "build-context-manifest-"));
  try {
    await writeFile(join(root, "Dockerfile"), "FROM scratch\n");
    const runtimeReleaseCatalogReceipt = catalog();
    const manifest = await createCloudBuildImageContextManifest({ contextDirectory: root, runtimeReleaseCatalogReceipt });
    const admitted = await admitCloudBuildImageContext({ contextDirectory: root, manifest, runtimeReleaseCatalogReceipt });
    assert.equal(admitted.runtimeReleaseCatalogDigest, runtimeReleaseCatalogReceipt.digest);
    assert.match(admitted.contextDigest, /^sha256:[a-f0-9]{64}$/u);
    await writeFile(join(root, "Dockerfile"), "FROM busybox\n");
    await assert.rejects(admitCloudBuildImageContext({ contextDirectory: root, manifest, runtimeReleaseCatalogReceipt }), /disagrees/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("context admission refuses malformed, drifting, and path-unbound runtime catalogs", async () => {
  const root = await mkdtemp(join(tmpdir(), "build-context-catalog-"));
  try {
    await writeFile(join(root, "Dockerfile"), "FROM scratch\n");
    const valid = catalog(), manifest = await createCloudBuildImageContextManifest({ contextDirectory: root, runtimeReleaseCatalogReceipt: valid });
    await assert.rejects(admitCloudBuildImageContext({ contextDirectory: root, manifest, runtimeReleaseCatalogReceipt: { ...valid, digest: "0".repeat(64) } }), /digest is invalid/u);
    const unboundBody = { ...valid, entries: [{ ...valid.entries[0], releaseRelativePath: "../../releases/other" }] };
    await assert.rejects(createCloudBuildImageContextManifest({ contextDirectory: root, runtimeReleaseCatalogReceipt: unboundBody }), /not digest-bound/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});
