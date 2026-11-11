import assert from "node:assert/strict";
import test from "node:test";
import { fabricateCloudBuildImage } from "../src/gcloud-cloud-build-image-fabrication.mjs";
const input={project:"five-six-one-group-dev",contextDirectory:"/tmp/gui-context",cloudBuildConfig:"/tmp/gui-context/cloudbuild.yaml",image:"us-central1-docker.pkg.dev/five-six-one-group-dev/union/wuxian-gui:c089de43"};
test("fabrication submits one declared context then returns only a registry-verified digest",async()=>{const calls=[];const receipt=await fabricateCloudBuildImage(input,{gcloud:async args=>{calls.push(args);return args[0]==="artifacts"?JSON.stringify([{tags:["c089de43"],version:"sha256:"+"a".repeat(64)}]):"{}";}});assert.equal(calls[0][0],"builds");assert.equal(calls[1][0],"artifacts");assert.match(receipt.object.content.image,/@sha256:a{64}$/u);});
test("fabrication refuses a config outside its declared context before effects",async()=>{await assert.rejects(fabricateCloudBuildImage({...input,cloudBuildConfig:"/tmp/other.yaml"},{gcloud:async()=>{throw new Error("effect");}}),/inside one declared/u);});
test("fabrication refuses an unverified tag",async()=>{await assert.rejects(fabricateCloudBuildImage(input,{gcloud:async args=>args[0]==="artifacts"?"[]":"{}"}),/verifiable immutable/u);});
