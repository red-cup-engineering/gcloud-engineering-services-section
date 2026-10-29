import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { cloudBuildAuthorityViolations, dockerfileAuthorityViolations, releaseAuthorityViolations, workflowAuthorityViolations } from "../src/release-authority-verification.mjs";

const revision = "a".repeat(40);
const builder = `gcr.io/cloud-builders/docker@sha256:${"b".repeat(64)}`;
const base = `node:24-bookworm@sha256:${"c".repeat(64)}`;
const authority = { runner: "ubuntu-24.04", actions: { "actions/checkout": { revision }, "actions/setup-node": { revision, inputs: { "node-version": "24.19.0" } } }, cloudBuild: { builders: [builder], imageSubstitution: "${_IMAGE}" }, docker: { bases: [base] } };

test("workflow authority admits only the declared runner, action commits, and tool input", () => {
  const valid = `jobs:\n  one:\n    runs-on: ubuntu-24.04\n    steps:\n      - uses: actions/checkout@${revision}\n      - uses: actions/setup-node@${revision}\n        with:\n          node-version: 24.19.0\n`;
  assert.deepEqual(workflowAuthorityViolations(valid, authority), []);
  assert.match(workflowAuthorityViolations(valid.replace("ubuntu-24.04", "ubuntu-latest"), authority).join("\n"), /runner/u);
  assert.match(workflowAuthorityViolations(valid.replace(revision, "v4"), authority).join("\n"), /not pinned/u);
  assert.match(workflowAuthorityViolations(valid.replace("24.19.0", "24"), authority).join("\n"), /node-version/u);
  assert.match(workflowAuthorityViolations(`${valid}      - uses: foreign/action@${revision}\n`, authority).join("\n"), /no admitted authority/u);
  assert.match(workflowAuthorityViolations(valid.replace(`      - uses: actions/setup-node@${revision}\n        with:\n          node-version: 24.19.0\n`, `      - run: node script.mjs\n      - uses: actions/setup-node@${revision}\n        with:\n          node-version: 24.19.0\n`), authority).join("\n"), /before.*setup-node/u);
  assert.match(workflowAuthorityViolations(valid.replace(/      - uses: actions\/setup-node@[\s\S]*?node-version: 24\.19\.0\n/u, ""), authority).join("\n"), /exactly one/u);
  assert.match(workflowAuthorityViolations(`${valid}      - uses: actions/setup-node@${revision}\n        with: { node-version: 24.19.0 }\n`, authority).join("\n"), /exactly one/u);
});

test("Cloud Build authority requires only admitted digest builders, exact image output, and verified provenance", () => {
  const valid = `# comments and quotes cannot change structure\nsteps:\n  - name: "${builder}"\n    args: ["build", "--pull", "--tag", "\${_IMAGE}", "."]\nimages: ["\${_IMAGE}"]\noptions:\n  logging: CLOUD_LOGGING_ONLY\n  requestedVerifyOption: VERIFIED\n`;
  assert.deepEqual(cloudBuildAuthorityViolations(valid, authority), []);
  assert.equal(cloudBuildAuthorityViolations(valid.replace("VERIFIED", "NOT_VERIFIED"), authority).length, 1);
  assert.equal(cloudBuildAuthorityViolations(valid.replace(builder, "gcr.io/cloud-builders/docker:latest"), authority).length, 1);
  const implicitBuilder = `docker@sha256:${"e".repeat(64)}`, implicitAuthority = structuredClone(authority); implicitAuthority.cloudBuild.builders = [implicitBuilder];
  assert.match(cloudBuildAuthorityViolations(valid.replace(builder, implicitBuilder), implicitAuthority).join("\n"), /explicit-registry/u);
  const alternateSubstitution = structuredClone(authority); alternateSubstitution.cloudBuild.imageSubstitution = "${_OTHER}";
  assert.match(cloudBuildAuthorityViolations(valid.replaceAll("${_IMAGE}", "${_OTHER}"), alternateSubstitution).join("\n"), /exactly.*_IMAGE/u);
  const foreign = valid.replace("images:", `  - name: foreign.example/tool@sha256:${"e".repeat(64)}\n    args: ["build", "--pull", "--tag", "\${_IMAGE}", "."]\nimages:`);
  assert.match(cloudBuildAuthorityViolations(foreign, authority).join("\n"), /step 1 builder/u);
  assert.match(cloudBuildAuthorityViolations(`${valid}\noptions: { logging: CLOUD_LOGGING_ONLY }\n`, authority).join("\n"), /invalid YAML 1.2/u);
});

test("Cloud Build authority binds a nondefault Dockerfile path with the carrier law", () => {
  const nestedAuthority = structuredClone(authority); nestedAuthority.cloudBuild.dockerfilePath = "container/Dockerfile";
  const valid = JSON.stringify({ steps: [{ name: builder, args: ["build", "--pull", "--file", "container/Dockerfile", "--tag", "${_IMAGE}", "."] }], images: ["${_IMAGE}"], options: { logging: "CLOUD_LOGGING_ONLY", requestedVerifyOption: "VERIFIED" } });
  assert.deepEqual(cloudBuildAuthorityViolations(valid, nestedAuthority), []);
  assert.match(cloudBuildAuthorityViolations(valid, authority).join("\n"), /Dockerfile path/u);
});

test("YAML authority parses quoted scalars and rejects duplicate or nested evasions", () => {
  const quoted = `jobs:\n  admitted:\n    runs-on: "ubuntu-24.04" # exact scalar\n    steps:\n      - uses: "actions/setup-node@${revision}"\n        with: { node-version: "24.19.0" }\n      - run: |\n          # node in a comment is not an invocation\n          node script.mjs\n`;
  assert.deepEqual(workflowAuthorityViolations(quoted, authority), []);
  assert.match(workflowAuthorityViolations(`${quoted}\njobs: {}\n`, authority).join("\n"), /invalid YAML 1.2/u);
  assert.match(workflowAuthorityViolations(quoted.replace("      - run:", `      - uses: foreign/action@${revision}\n      - run:`), authority).join("\n"), /no admitted authority/u);
});

test("Docker authority refuses moving and unlisted bases", () => {
  assert.deepEqual(dockerfileAuthorityViolations(`FROM ${base}\n`, authority), []);
  assert.match(dockerfileAuthorityViolations("FROM node:24-bookworm\n", authority).join("\n"), /not digest pinned/u);
  assert.match(dockerfileAuthorityViolations(`FROM node:24@sha256:${"d".repeat(64)}\n`, authority).join("\n"), /disagrees/u);
});

test("release authority binds the context Dockerfile path independently from its source path", () => {
  const root = mkdtempSync(join(tmpdir(), "cloud-build-authority-"));
  mkdirSync(join(root, "source", "ops"), { recursive: true });
  writeFileSync(join(root, "source", "ops", "Dockerfile"), `FROM ${base}\n`);
  writeFileSync(join(root, "cloudbuild.yaml"), `steps:\n  - name: "${builder}"\n    args: ["build", "--pull", "--tag", "\${_IMAGE}", "."]\nimages: ["\${_IMAGE}"]\noptions:\n  logging: CLOUD_LOGGING_ONLY\n  requestedVerifyOption: VERIFIED\n`);
  const mapped = structuredClone(authority);
  mapped.type = "EmswebCloudReleaseAuthority";
  mapped.version = 1;
  mapped.workflows = [];
  mapped.cloudBuild.path = "cloudbuild.yaml";
  mapped.docker.path = "source/ops/Dockerfile";
  mapped.docker.contextPath = "Dockerfile";
  assert.deepEqual(releaseAuthorityViolations(root, mapped), []);

  const mismatched = structuredClone(mapped);
  mismatched.docker.contextPath = "container/Dockerfile";
  assert.match(releaseAuthorityViolations(root, mismatched).join("\n"), /context path/u);

  const legacy = structuredClone(mapped);
  delete legacy.docker.contextPath;
  legacy.cloudBuild.dockerfilePath = "source/ops/Dockerfile";
  writeFileSync(join(root, "cloudbuild.yaml"), JSON.stringify({ steps: [{ name: builder, args: ["build", "--pull", "--file", "source/ops/Dockerfile", "--tag", "${_IMAGE}", "."] }], images: ["${_IMAGE}"], options: { logging: "CLOUD_LOGGING_ONLY", requestedVerifyOption: "VERIFIED" } }));
  assert.deepEqual(releaseAuthorityViolations(root, legacy), []);
});
