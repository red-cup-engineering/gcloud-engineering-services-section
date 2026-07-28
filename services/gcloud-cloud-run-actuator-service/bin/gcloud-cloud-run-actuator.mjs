#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { actuate } from "../src/gcloud-cloud-run-actuator.mjs";

const file = process.argv.indexOf("--input-file");
const input = JSON.parse(readFileSync(file === -1 ? 0 : process.argv[file + 1], "utf8"));
try { process.stdout.write((await actuate(input)).jsonl); }
catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
