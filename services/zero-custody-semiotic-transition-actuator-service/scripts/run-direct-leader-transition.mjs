#!/usr/bin/env node

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Interface, Signature, recoverAddress } from "ethers";
import { makeNiUri as rawNiUri } from "@red-cup-engineering/ni-uri-services-section";
import { prepareEnterpriseUserOperation } from "../runtime/enterprise-user-operation.mjs";

const WORK_ORDER = "wo-services-obsmetrological-services-section-a1ba588a07fa.json";
const RESULT_NI = "ni:///sha-256;WCT8BY86qSKwgmDDbwiIrW2AHSmXHYK9bV_ZaxKgK54";
const ABI = new Interface(["function raiseDemand(bytes carrier,bytes32 grounding,bytes32 wantedLaw)"]);
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
function kmsSigner({ keyVersion, expectedAddress }) { return { async signUserOperationHash(hash) { const token = await (await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "metadata-flavor": "Google" } })).json(); const response = await fetch(`https://cloudkms.googleapis.com/v1/${keyVersion}:asymmetricSign`, { method: "POST", headers: { authorization: `Bearer ${token.access_token}`, "content-type": "application/json" }, body: JSON.stringify({ digest: { sha256: Buffer.from(hash.slice(2), "hex").toString("base64") } }) }); const body = await response.json(); if (!response.ok || !body.signature) throw new Error("transition KMS refused signing"); const der = Buffer.from(body.signature, "base64"); let offset = 2; const integer = () => { if (der[offset++] !== 2) throw new Error("invalid KMS DER signature"); const size = der[offset++]; const value = der.subarray(offset, offset + size); offset += size; return value.length === 33 ? value.subarray(1) : value; }; const r = integer(); const s = integer(); for (const yParity of [0, 1]) { const signature = Signature.from({ r: `0x${Buffer.concat([Buffer.alloc(32 - r.length), r]).toString("hex")}`, s: `0x${Buffer.concat([Buffer.alloc(32 - s.length), s]).toString("hex")}`, yParity }).serialized; if (recoverAddress(hash, signature).toLowerCase() === expectedAddress.toLowerCase()) return signature; } throw new Error("transition KMS signature does not recover to bound signer"); } }; }
const required = (name) => { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; };
const input = JSON.parse(required("DIRECT_LEADER_TRANSITION_JSON"));
if (input.workOrder !== WORK_ORDER || input.workOrderResultNi !== RESULT_NI || input.authorityClass !== "direct-leader-emergency" || input.ucanVerified !== false) throw new Error("input is not the exact direct-leader emergency authority");
const manifest = input.transitionManifest;
const manifestNi = rawNiUri(Buffer.from(canonical(manifest), "utf8"));
if (!manifest || input.transitionManifestNi !== manifestNi || !/^eip155:[1-9][0-9]*$/u.test(manifest.chain ?? "") || !/^0x[0-9a-fA-F]{40}$/u.test(manifest.exchange ?? "") || !/^0x[0-9a-fA-F]{40}$/u.test(manifest.entryPoint ?? "") || !/^https:\/\/run\.googleapis\.com\/v2\/projects\/[^/]+\/locations\/[^/]+\/jobs\/[^/]+:run$/u.test(manifest.bundlerJobRunUrl ?? "")) throw new Error("a digest-bound transition deployment manifest is required");
if (input.chain !== manifest.chain || input.exchange?.toLowerCase() !== manifest.exchange.toLowerCase() || input.entryPoint?.toLowerCase() !== manifest.entryPoint.toLowerCase() || input.preparationProfile?.entryPoint?.toLowerCase() !== manifest.entryPoint.toLowerCase()) throw new Error("input does not bind the declared transition manifest");
if (input.paymaster !== null) throw new Error("the emergency transition permits no paymaster");
if (!input.binding || !input.demandNi || !input.rmnSemanticDigest || !input.raiseDemand) throw new Error("binding, demand identity, semantic digest, and raiseDemand manifest are required");
const bindingRoot = await mkdtemp(join(tmpdir(), "sxc-transition-"));
const bindingPath = join(bindingRoot, "binding.json");
await writeFile(bindingPath, `${JSON.stringify(input.binding)}\n`, { mode: 0o600 });
const signer = kmsSigner({ keyVersion: required("TRANSITION_KMS_KEY_VERSION"), expectedAddress: required("TRANSITION_SIGNER_ADDRESS") });
const calldata = ABI.encodeFunctionData("raiseDemand", [input.raiseDemand.carrier, input.raiseDemand.grounding, input.raiseDemand.wantedLaw]);
const prepared = await prepareEnterpriseUserOperation({ bindingPath, rpcUrl: required("CHAIN_RPC_URL"), bundlerUrl: input.preparationProfile ? undefined : required("BUNDLER_RPC_URL"), preparationProfile: input.preparationProfile, target: manifest.exchange, calldata, rmnSemanticDigest: input.rmnSemanticDigest, signUserOperationHash: (hash) => signer.signUserOperationHash(hash), forbidPaymaster: true, authorizeUserOperation: ({ chainId, entryPoint, account, operation }) => {
  if (`eip155:${chainId}` !== manifest.chain || entryPoint.toLowerCase() !== manifest.entryPoint.toLowerCase() || account.toLowerCase() !== input.binding.account.address.toLowerCase() || operation.paymaster !== null) throw new Error("prepared operation exceeds emergency boundary");
} });
const bundle = { beneficiary: required("BUNDLER_BENEFICIARY"), operation: prepared.operation, gasLimit: required("BUNDLER_GAS_LIMIT"), maxFeePerGas: prepared.fees.maxFeePerGas, maxPriorityFeePerGas: prepared.fees.maxPriorityFeePerGas, nonce: required("BUNDLER_NONCE") };
if (process.env.PREPARE_ONLY === "true") { process.stdout.write(`${JSON.stringify({ type: "DirectLeaderEmergencyBundleInput", authorityClass: input.authorityClass, ucanVerified: false, workOrder: WORK_ORDER, workOrderResultNi: RESULT_NI, demandNi: input.demandNi, prepared, bundle })}\\n`); process.exit(0); }
const token = (await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=https://run.googleapis.com/&format=full", { headers: { "metadata-flavor": "Google" } })).text();
const response = await fetch(manifest.bundlerJobRunUrl, { method: "POST", headers: { authorization: `Bearer ${await token}`, "content-type": "application/json" }, body: JSON.stringify({ overrides: { containerOverrides: [{ env: [{ name: "BUNDLE_INPUT_JSON", value: JSON.stringify(bundle) }] }] } }) });
if (!response.ok) throw new Error(`bundler Job refused: ${await response.text()}`);
process.stdout.write(`${JSON.stringify({ type: "DirectLeaderEmergencyTransitionJobExecution", authorityClass: input.authorityClass, ucanVerified: false, demandNi: input.demandNi, userOpHash: prepared.userOpHash, bundlerOperation: await response.json() })}\\n`);
