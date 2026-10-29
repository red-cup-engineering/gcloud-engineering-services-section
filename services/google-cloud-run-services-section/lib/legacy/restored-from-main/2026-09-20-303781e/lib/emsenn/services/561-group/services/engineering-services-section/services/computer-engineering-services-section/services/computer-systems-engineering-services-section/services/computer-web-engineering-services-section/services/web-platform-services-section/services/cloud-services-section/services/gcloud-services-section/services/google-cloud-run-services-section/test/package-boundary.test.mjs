import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expectedFiles = Object.freeze([
  "README.md",
  "content/resources/notebooklm-inference-team.desired.json",
  "content/resources/notebooklm-inference-team.observed.json",
  "package.json",
  "src/cloud-run-resource-projection.mjs",
]);
const repositoryDirectory = "lib/emsenn/services/561-group/services/engineering-services-section/services/computer-engineering-services-section/services/computer-systems-engineering-services-section/services/computer-web-engineering-services-section/services/web-platform-services-section/services/cloud-services-section/services/gcloud-services-section/services/google-cloud-run-services-section";

function dryPack() {
  const result = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.length, 1);
  return report[0];
}

test("the publishable carrier identifies its exact internal owner and repository location", () => {
  const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  assert.equal(manifest.name, "@red-cup-engineering/google-cloud-run-services-section");
  assert.equal(manifest.version, "0.2.0");
  assert.equal(manifest.private, false);
  assert.equal(manifest.license, "UNLICENSED");
  assert.deepEqual(manifest.repository, {
    type: "git",
    url: "git+https://github.com/emsenn/bare-cedar-fog.git",
    directory: repositoryDirectory,
  });
});

test("the npm carrier contains exactly the public declarations and projection module", () => {
  const report = dryPack();
  assert.equal(report.id, "@red-cup-engineering/google-cloud-run-services-section@0.2.0");
  assert.deepEqual(report.files.map(({ path }) => path).sort(), [...expectedFiles].sort());
});

test("the carrier contains secret requirements and references, never secret material", () => {
  const desired = JSON.parse(readFileSync(resolve(root, "content/resources/notebooklm-inference-team.desired.json"), "utf8"));
  assert.equal(desired.secretBindings.type, "GoogleCloudRunSecretBindingsDeclaration");
  assert.equal(desired.secretBindings.status, "partial");
  assert.deepEqual(desired.secretBindings.values, { API_KEY_CLOUDFLARE_R2_EDIT: "cloudflare-r2-api-token:1", NOTEBOOKLM_AUTH_JSON: "notebooklm-auth-json:3", "/secrets/activitypub/keys.json": "notebooklm-activitypub-keys:1" });
  assert.deepEqual(desired.secretBindings.unresolved.map(({ name }) => name), ["ACTIVITYPUB_INBOX_BEARER_TOKEN_FILE", "AGENT_CARD_SIGNING_KEY", "NOTEBOOKLM_ARTIFACT_CAPABILITY_KEY"]);
  assert.equal(desired.imageConstruction.providerRequirement, null);
  assert.equal(desired.imageConstruction.ociImageObservation, null);
  assert.match(desired.imageConstruction.ociSelection.requestedReference, /^registry-1\.docker\.io\/library\/node@sha256:[a-f0-9]{64}$/u);
  assert.equal(desired.imageConstruction.ociSelection.requestedReference.endsWith(`@${desired.imageConstruction.ociSelection.tagIndexDigest}`), true);
  assert.equal(desired.imageConstruction.authoritySelections.node.baseImage.endsWith(`@${desired.imageConstruction.ociSelection.selectedManifestDigest}`), true);

  const forbiddenMaterial = [
    /-----BEGIN (?:EC |RSA |OPENSSH )?PRIVATE KEY-----/u,
    /"private_key"\s*:/u,
    /"client_secret"\s*:/u,
    /\bAIza[0-9A-Za-z_-]{35}\b/u,
    /\bya29\.[0-9A-Za-z_-]{20,}\b/u,
    /\bgh[opsu]_[0-9A-Za-z]{20,}\b/u,
  ];
  for (const path of expectedFiles) {
    const bytes = readFileSync(resolve(root, path), "utf8");
    for (const pattern of forbiddenMaterial) assert.doesNotMatch(bytes, pattern, `${path} contains secret material matching ${pattern}`);
  }
});
