import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const source = await readFile(new URL("../src/server.mjs", import.meta.url), "utf8");

test("the projection names the bounded successor membrane, not the Besu RPC", () => {
  assert.match(source, /10\.128\.0\.2:8562/u);
  assert.match(source, /\/v1\/semiotic-exchange\/rpc/u);
  assert.doesNotMatch(source, /10\.128\.0\.2:8563/u);
});

test("the operator cannot supply an arbitrary history origin", () => {
  assert.match(source, /chainReaderOrigin\.hostname !== "10\.128\.0\.2"/u);
  assert.match(source, /chainReaderOrigin\.port !== "8562"/u);
});

test("history warmup cannot prevent the public process from listening", () => {
  assert.ok(source.indexOf(".listen(port") < source.indexOf("const warmup = await worker.fetch"));
  assert.match(source, /private dimension warmup unavailable/u);
});

test("the retired projection receives one exact successor transplant", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wuxian-coordinate-"));
  const worker = join(directory, "worker.mjs");
  await writeFile(worker, "const chain='eip155:5615610';const exchange='0x98bbc65824962b61df876a47b5779c4ecbbd4939';const query={fromBlock:5619n};\n");
  execFileSync(process.execPath, [fileURLToPath(new URL("../scripts/transplant-successor-coordinate.mjs", import.meta.url)), worker]);
  const transplanted = await readFile(worker, "utf8");
  assert.match(transplanted, /0xc4234dc42c9d93bc7d61b0354aba2729ae52e322/u);
  assert.match(transplanted, /eip155:5615611/u);
  assert.match(transplanted, /fromBlock:\s*70n/u);
  assert.doesNotMatch(transplanted, /0x98bbc/u);
  assert.doesNotMatch(transplanted, /eip155:5615610/u);
});
