import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2] ?? "/app/worker.mjs";
let source = readFileSync(file, "utf8");
const transplants = [
  [/eip155:5615610/gu, "eip155:5615611"],
  [/0x98bbc65824962b61df876a47b5779c4ecbbd4939/giu, "0xc4234dc42c9d93bc7d61b0354aba2729ae52e322"],
  [/fromBlock:\s*5619n/gu, "fromBlock: 70n"],
];

for (const [retired, successor] of transplants) {
  const occurrences = [...source.matchAll(retired)].length;
  if (occurrences !== 1) {
    const clue = retired.source.includes("5619") || retired.source.includes("5615610")
      ? [...source.matchAll(/.{0,40}(?:5619|5615610).{0,40}/gu)].slice(0, 10).map(({ 0: match }) => match).join(" | ")
      : "";
    throw new Error(`expected one retired projection coordinate ${retired.source}, observed ${occurrences}${clue ? `; contexts: ${clue}` : ""}`);
  }
  source = source.replace(retired, successor);
}

writeFileSync(file, source);
