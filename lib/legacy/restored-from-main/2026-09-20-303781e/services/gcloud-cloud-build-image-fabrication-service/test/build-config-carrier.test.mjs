import assert from "node:assert/strict";
import test from "node:test";
import { admitCloudBuildImageBuildConfigCarrier, formCloudBuildImageBuildConfigCarrier } from "../src/build-config-carrier.mjs";
import { cloudBuildAuthorityViolations } from "../src/release-authority-verification.mjs";

const builderImage = `gcr.io/cloud-builders/docker@sha256:${"6".repeat(64)}`;

test("forms one deterministic Cloud Build carrier for the npm-owned Dockerfile", () => {
  const first = formCloudBuildImageBuildConfigCarrier({ builderImage });
  const second = formCloudBuildImageBuildConfigCarrier({ builderImage });
  assert.deepEqual(first, second);
  assert.equal(first.carrier.path, "cloudbuild.image.json");
  assert.equal(first.carrier.mode, 0o644);
  assert.deepEqual(first.staticCarriers, [{ path: first.carrier.path, mode: first.carrier.mode, utf8: first.carrier.utf8 }]);
  assert.deepEqual(JSON.parse(first.carrier.utf8), first.configuration);
  assert.deepEqual(first.configuration.steps[0], { name: builderImage, args: ["build", "--pull", "--tag", "${_IMAGE}", "."] });
  assert.deepEqual(first.configuration.images, ["${_IMAGE}"]);
  assert.deepEqual(first.configuration.options, { logging: "CLOUD_LOGGING_ONLY", requestedVerifyOption: "VERIFIED" });
  assert.deepEqual(cloudBuildAuthorityViolations(first.carrier.utf8, { cloudBuild: { builders: [builderImage], imageSubstitution: "${_IMAGE}" } }), []);
  assert.deepEqual(admitCloudBuildImageBuildConfigCarrier(first), first);
});

test("admits an explicit nested Dockerfile and carrier path without acquiring filesystem authority", () => {
  const value = formCloudBuildImageBuildConfigCarrier({ builderImage, dockerfilePath: "container/Dockerfile", path: "build/cloudbuild.json" });
  assert.equal(value.configuration.steps[0].args[3], "container/Dockerfile");
  assert.equal(value.carrier.path, "build/cloudbuild.json");
  assert.deepEqual(cloudBuildAuthorityViolations(value.carrier.utf8, { cloudBuild: { builders: [builderImage], imageSubstitution: "${_IMAGE}", dockerfilePath: "container/Dockerfile" } }), []);
});

test("refuses mutable builders, traversal, collisions, and carrier drift", () => {
  assert.throws(() => formCloudBuildImageBuildConfigCarrier({ builderImage: "gcr.io/cloud-builders/docker:latest" }), /digest-pinned/u);
  assert.throws(() => formCloudBuildImageBuildConfigCarrier({ builderImage, dockerfilePath: "../Dockerfile" }), /traversal/u);
  assert.throws(() => formCloudBuildImageBuildConfigCarrier({ builderImage, path: "Dockerfile" }), /not overlap/u);
  assert.throws(() => formCloudBuildImageBuildConfigCarrier({ builderImage, dockerfilePath: "build", path: "build/cloudbuild.json" }), /not overlap/u);
  assert.throws(() => formCloudBuildImageBuildConfigCarrier({ builderImage, dockerfilePath: "${_DOCKERFILE}" }), /substitution syntax/u);
  assert.throws(() => formCloudBuildImageBuildConfigCarrier({ builderImage: `docker@sha256:${"6".repeat(64)}` }), /digest-pinned/u);
  assert.throws(() => formCloudBuildImageBuildConfigCarrier({ builderImage, token: "hidden" }), /unknown members/u);
  const drift = structuredClone(formCloudBuildImageBuildConfigCarrier({ builderImage }));
  drift.configuration.options.requestedVerifyOption = "NOT_VERIFIED";
  assert.throws(() => admitCloudBuildImageBuildConfigCarrier(drift), /invalid/u);
  const adapterDrift = structuredClone(formCloudBuildImageBuildConfigCarrier({ builderImage }));
  adapterDrift.staticCarriers[0].utf8 += " ";
  assert.throws(() => admitCloudBuildImageBuildConfigCarrier(adapterDrift), /invalid/u);
});
