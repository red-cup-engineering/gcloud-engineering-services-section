#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { createGcsImmutableEvidenceStore } from "@red-cup-engineering/gcloud-runtime-authorities-service";
import { fabricateCloudBuildImage, persistCloudBuildImageReceipt } from "../src/gcloud-cloud-build-image-fabrication.mjs";

const executeFile = promisify(execFile);
function option(argv, name, required = true) {
  const index = argv.indexOf(name);
  if (index >= 0 && argv[index + 1]) return argv[index + 1];
  if (required) throw new TypeError(`${name} is required`);
  return null;
}

export async function runCloudBuildImageFabricationCli(argv, { gcloud, evidenceStoreFactory = createGcsImmutableEvidenceStore } = {}) {
  const contextDirectory = resolve(option(argv, "--context"));
  const receipt = await fabricateCloudBuildImage({
    project: option(argv, "--project"), image: option(argv, "--image"), sourceSha: option(argv, "--source-sha"),
    contextDirectory, cloudBuildConfig: resolve(option(argv, "--config")), buildServiceAccount: option(argv, "--build-service-account", false) ?? undefined,
    contextManifest: JSON.parse(await readFile(resolve(option(argv, "--context-manifest")), "utf8")),
    runtimeReleaseCatalogReceipt: JSON.parse(await readFile(resolve(option(argv, "--runtime-release-catalog-receipt")), "utf8")),
    packageGraphDigest: option(argv, "--package-graph-digest", false) ?? undefined,
  }, { gcloud });
  await writeFile(resolve(option(argv, "--receipt")), `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
  const destination = option(argv, "--evidence-destination", false);
  let custody = null;
  if (destination) {
    const bucket = /^gs:\/\/([^/]+)\//u.exec(destination)?.[1];
    if (!bucket) throw new TypeError("--evidence-destination must be a GCS object URI");
    custody = await persistCloudBuildImageReceipt(receipt, destination, { evidenceStore: evidenceStoreFactory({ bucket }) });
    const pointerPath = option(argv, "--pointer", false);
    if (pointerPath) await writeFile(resolve(pointerPath), `${JSON.stringify(custody, null, 2)}\n`, { flag: "wx" });
  }
  return Object.freeze({ receipt, custody });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const gcloud = async (args) => (await executeFile("gcloud", args, { maxBuffer: 32 * 1024 * 1024 })).stdout;
  const result = await runCloudBuildImageFabricationCli(process.argv.slice(2), { gcloud });
  process.stdout.write(`${JSON.stringify({ ...result.receipt.object.content, custody: result.custody })}\n`);
}
