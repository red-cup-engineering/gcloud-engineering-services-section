#!/usr/bin/env node

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Interface } from "ethers";
import { prepareEnterpriseUserOperation } from "@red-cup-engineering/ethereum-services-section/enterprise-user-operation";
import { createGoogleCloudKmsSecp256k1Signer } from "../src/zero-custody-semiotic-transition-actuator.mjs";

const WORK_ORDER = "wo-services-obsmetrological-services-section-a1ba588a07fa.json";
const RESULT_NI = "ni:///sha-256;WCT8BY86qSKwgmDDbwiIrW2AHSmXHYK9bV_ZaxKgK54";
const EXCHANGE = "0x98bBC65824962b61dF876A47B5779C4EcBBD4939";
const ENTRY_POINT = "0x4337084d9e255ff0702461cf8895ce9e3b5ff108";
const ABI = new Interface(["function raiseDemand(bytes carrier,bytes32 grounding,bytes32 wantedLaw)"]);
const required = (name) => { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; };
const input = JSON.parse(required("DIRECT_LEADER_TRANSITION_JSON"));
if (input.workOrder !== WORK_ORDER || input.workOrderResultNi !== RESULT_NI || input.authorityClass !== "direct-leader-emergency" || input.ucanVerified !== false) throw new Error("input is not the exact direct-leader emergency authority");
if (input.chain !== "eip155:5615610" || input.exchange?.toLowerCase() !== EXCHANGE.toLowerCase() || input.entryPoint?.toLowerCase() !== ENTRY_POINT.toLowerCase()) throw new Error("input chain contracts drift from the sealed transition");
if (input.paymaster !== null) throw new Error("the emergency transition permits no paymaster");
if (!input.binding || !input.demandNi || !input.rmnSemanticDigest || !input.raiseDemand) throw new Error("binding, demand identity, semantic digest, and raiseDemand manifest are required");
const bindingRoot = await mkdtemp(join(tmpdir(), "sxc-transition-"));
const bindingPath = join(bindingRoot, "binding.json");
await writeFile(bindingPath, `${JSON.stringify(input.binding)}\\n`, { mode: 0o600 });
const signer = createGoogleCloudKmsSecp256k1Signer({ keyVersion: required("TRANSITION_KMS_KEY_VERSION"), expectedAddress: required("TRANSITION_SIGNER_ADDRESS"), accessToken: async () => (await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "metadata-flavor": "Google" } })).json().then(({ access_token }) => access_token) });
const calldata = ABI.encodeFunctionData("raiseDemand", [input.raiseDemand.carrier, input.raiseDemand.grounding, input.raiseDemand.wantedLaw]);
const prepared = await prepareEnterpriseUserOperation({ bindingPath, rpcUrl: required("CHAIN_RPC_URL"), bundlerUrl: required("BUNDLER_RPC_URL"), target: EXCHANGE, calldata, rmnSemanticDigest: input.rmnSemanticDigest, signUserOperationHash: (hash) => signer.signUserOperationHash(hash), forbidPaymaster: true, authorizeUserOperation: ({ chainId, entryPoint, account, operation }) => {
  if (chainId !== 5615610 || entryPoint.toLowerCase() !== ENTRY_POINT.toLowerCase() || account.toLowerCase() !== input.binding.account.address.toLowerCase() || operation.paymaster !== null) throw new Error("prepared operation exceeds emergency boundary");
} });
const bundle = { beneficiary: required("BUNDLER_BENEFICIARY"), operation: prepared.operation, gasLimit: required("BUNDLER_GAS_LIMIT"), maxFeePerGas: prepared.fees.maxFeePerGas, maxPriorityFeePerGas: prepared.fees.maxPriorityFeePerGas, nonce: required("BUNDLER_NONCE") };
if (process.env.PREPARE_ONLY === "true") { process.stdout.write(`${JSON.stringify({ type: "DirectLeaderEmergencyBundleInput", authorityClass: input.authorityClass, ucanVerified: false, workOrder: WORK_ORDER, workOrderResultNi: RESULT_NI, demandNi: input.demandNi, prepared, bundle })}\\n`); process.exit(0); }
const token = (await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=https://run.googleapis.com/&format=full", { headers: { "metadata-flavor": "Google" } })).text();
const response = await fetch(required("BUNDLER_JOB_RUN_URL"), { method: "POST", headers: { authorization: `Bearer ${await token}`, "content-type": "application/json" }, body: JSON.stringify({ overrides: { containerOverrides: [{ env: [{ name: "BUNDLE_INPUT_JSON", value: JSON.stringify(bundle) }] }] } }) });
if (!response.ok) throw new Error(`bundler Job refused: ${await response.text()}`);
process.stdout.write(`${JSON.stringify({ type: "DirectLeaderEmergencyTransitionJobExecution", authorityClass: input.authorityClass, ucanVerified: false, demandNi: input.demandNi, userOpHash: prepared.userOpHash, bundlerOperation: await response.json() })}\\n`);
