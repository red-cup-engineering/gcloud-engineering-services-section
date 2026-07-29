import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Interface, Wallet } from "ethers";
import { delegate, invoke } from "@ucanto/core";
import { ed25519 } from "@ucanto/principal";
import { createCanonicalSemioticTransitionAuthorityAdmission, createZeroCustodySemioticTransitionActuator } from "../src/zero-custody-semiotic-transition-actuator.mjs";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const ENTRY = "0x2222222222222222222222222222222222222222";
const EXCHANGE = "0x3333333333333333333333333333333333333333";
const HASH = `0x${"44".repeat(32)}`;
const TX = `0x${"55".repeat(32)}`;
const RMN = `0x${"66".repeat(32)}`;
const SETTLE_SELECTOR = new Interface(["function settleDemand(bytes32 demand,bytes carrier)"]).getFunction("settleDemand").selector;
const accountAbi = new Interface(["function entryPoint() view returns (address)", "function validateUserOp((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp,bytes32 userOpHash,uint256 missingAccountFunds) returns (uint256)"]);
const entryAbi = new Interface(["function getNonce(address sender,uint192 key) view returns (uint256)", "function getUserOpHash((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp) view returns (bytes32)"]);
const bindingAccountAbi = new Interface([
  "function eip712Domain() view returns (bytes1 fields,string name,string version,uint256 chainId,address verifyingContract,bytes32 salt,uint256[] extensions)",
  "function policySigner() view returns (address)", "function entryPoint() view returns (address)",
  "function isValidSignature(bytes32 hash,bytes signature) view returns (bytes4)",
]);
const RESOURCE = `did:pkh:eip155:31337:${ACCOUNT}`;
const CAPABILITY = Object.freeze({ with: RESOURCE, can: "semiotic-exchange/settle-demand", nb: { locus: "ni:///sha-256;test" } });
function authorityReceipts(capability = CAPABILITY) {
  const capabilityNi = `ni:///sha-256;${"q".repeat(43)}`;
  const shared = { controller: `did:key:z${"A".repeat(48)}`, actor: `did:key:z${"B".repeat(48)}`,
    delegationCid: `b${"a".repeat(58)}`, invocationCid: `b${"c".repeat(58)}`, capability, capabilityNi };
  return { ucanReceipt: { id: `ni:///sha-256;${"u".repeat(43)}`, type: "UcanInvocationVerificationReceipt", version: 1,
    disposition: "authorized", revocationStatus: "active", ...shared },
  bindingReceipt: { id: `ni:///sha-256;${"b".repeat(43)}`, type: "EnterpriseAccountControllerBindingReceipt",
    version: 1, protocol: "ERC-1271", disposition: "bound",
    admissionPolicy: "reverify-erc1271-and-userop-nonce-at-every-admission", resource: RESOURCE,
    rmnSemanticDigest: RMN, userOpNonce: "0", ...shared } };
}

test("canonical admission produces the exact UCAN and finalized ERC-1271 receipts consumed by SXC-M7", async () => {
  const controller = await ed25519.generate(), actor = await ed25519.generate(), executor = await ed25519.generate();
  const now = Math.floor(Date.now() / 1000);
  const delegation = await delegate({ issuer: controller, audience: actor, capabilities: [CAPABILITY],
    notBefore: now - 2, expiration: now + 120, nonce: "delegation" });
  const invocation = await invoke({ issuer: actor, audience: executor, capability: CAPABILITY,
    proofs: [delegation], notBefore: now - 1, expiration: now + 60, nonce: "invocation" }).delegate();
  const blockHash = `0x${"aa".repeat(32)}`, finalizedHash = `0x${"bb".repeat(32)}`;
  const rpc = async (method, params) => {
    if (method === "eth_chainId") return "0x7a69";
    if (method === "eth_getBlockByNumber" && params[0] === "finalized") return { number: "0x78", hash: finalizedHash, timestamp: `0x${now.toString(16)}` };
    if (method === "eth_getBlockByNumber") return { number: "0x64", hash: blockHash, timestamp: `0x${now.toString(16)}` };
    if (method === "eth_getCode") return "0x6001600055";
    const { to, data } = params[0];
    if (to.toLowerCase() === ENTRY.toLowerCase()) return entryAbi.encodeFunctionResult("getNonce", [0n]);
    if (data.startsWith(bindingAccountAbi.getFunction("eip712Domain").selector)) return bindingAccountAbi.encodeFunctionResult("eip712Domain", ["0x0f", "Union Sovereign Enterprise Account", "3", 31337n, ACCOUNT, `0x${"00".repeat(32)}`, []]);
    if (data.startsWith(bindingAccountAbi.getFunction("policySigner").selector)) return bindingAccountAbi.encodeFunctionResult("policySigner", ["0x4444444444444444444444444444444444444444"]);
    if (data.startsWith(bindingAccountAbi.getFunction("entryPoint").selector)) return bindingAccountAbi.encodeFunctionResult("entryPoint", [ENTRY]);
    if (data.startsWith(bindingAccountAbi.getFunction("isValidSignature").selector)) return bindingAccountAbi.encodeFunctionResult("isValidSignature", ["0x1626ba7e"]);
    throw new Error(`unexpected ${method}`);
  };
  const admit = createCanonicalSemioticTransitionAuthorityAdmission({ authority: executor,
    controller: controller.did(), actor: actor.did(), isRevoked: async () => false, rpc });
  const receipts = await admit({ invocation, caveats: CAPABILITY.nb, resource: RESOURCE,
    operation: "settleDemand", rmnSemanticDigest: RMN,
    binding: { a2aCorrelation: "task-1/message-1", userOpNonce: "0", notBefore: String(now - 1),
      expiration: String(now + 60), challengeNonce: `0x${"77".repeat(32)}`,
      signature: `0x${"88".repeat(65)}`, block: "100", blockHash } });
  assert.equal(receipts.ucanReceipt.ucanVersion, "0.9.1");
  assert.equal(receipts.bindingReceipt.delegationCid, receipts.ucanReceipt.delegationCid);
  assert.equal(receipts.bindingReceipt.capabilityNi, receipts.ucanReceipt.capabilityNi);
  assert.match(receipts.ucanReceipt.id, /^ni:\/\/\/sha-256;/u);
  assert.match(receipts.bindingReceipt.id, /^ni:\/\/\/sha-256;/u);
});

test("SXC-M7 runner has no key/funds and returns AP(CloudEvent(A2A(RMN))) after a sponsored UserOperation", async (context) => {
  const signer = Wallet.createRandom();
  const directory = await mkdtemp(join(tmpdir(), "sxc-m7-"));
  const bindingPath = join(directory, "binding.json");
  await writeFile(bindingPath, JSON.stringify({ chain: { chainId: 31337 }, account: { address: ACCOUNT, caip10: `eip155:31337:${ACCOUNT}` }, policy: { signer: signer.address } }));
  let userOperation;
  const server = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const { id, method, params = [] } = JSON.parse(Buffer.concat(chunks)); let result;
    if (method === "eth_chainId") result = "0x7a69";
    else if (method === "eth_gasPrice") result = "0x3b9aca00";
    else if (method === "eth_supportedEntryPoints") result = [ENTRY];
    else if (method === "eth_estimateUserOperationGas") result = { callGasLimit: "0x186a0", verificationGasLimit: "0x30d40", preVerificationGas: "0xc350" };
    else if (method === "eth_sendUserOperation") { userOperation = params[0]; result = HASH; }
    else if (method === "eth_getUserOperationReceipt") result = { success: true, receipt: { transactionHash: TX, blockNumber: "0x7" } };
    else if (method === "eth_call") { const data = params[0].data; if (data.startsWith(accountAbi.getFunction("entryPoint").selector)) result = accountAbi.encodeFunctionResult("entryPoint", [ENTRY]); else if (data.startsWith(entryAbi.getFunction("getNonce").selector)) result = entryAbi.encodeFunctionResult("getNonce", [0n]); else if (data.startsWith(entryAbi.getFunction("getUserOpHash").selector)) result = entryAbi.encodeFunctionResult("getUserOpHash", [HASH]); else if (data.startsWith(accountAbi.getFunction("validateUserOp").selector)) result = accountAbi.encodeFunctionResult("validateUserOp", [0n]); else throw new Error("unexpected eth_call"); }
    else throw new Error(`unexpected ${method}`);
    response.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); context.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;
  const remoteSigner = Object.freeze({ custody: "remote-cloud-kms-hsm", signUserOperationHash: async (hash) => signer.signingKey.sign(hash).serialized });
  const paymaster = Object.freeze({ stub: async () => ({ paymaster: "0x4444444444444444444444444444444444444444", paymasterData: "0x", paymasterVerificationGasLimit: "0x1", paymasterPostOpGasLimit: "0x1" }), final: async () => ({ paymaster: "0x4444444444444444444444444444444444444444", paymasterData: "0x1234", paymasterVerificationGasLimit: "0x1", paymasterPostOpGasLimit: "0x1" }) });
  const actuator = createZeroCustodySemioticTransitionActuator({ bindingPath, rpcUrl: url, bundlerUrl: url, exchange: EXCHANGE, resource: RESOURCE, remoteSigner, paymaster, admitAuthority: async (input) => input, policy: { account: ACCOUNT, maxSignatures: 1, selectors: [SETTLE_SELECTOR], rmnSemanticDigests: [RMN], maxGas: { callGasLimit: "0x186a0", verificationGasLimit: "0x30d40", preVerificationGas: "0xc350", maxFeePerGas: "0x77359400", maxPriorityFeePerGas: "0x3b9aca00" } } });
  assert.equal(actuator.custody, "none"); assert.equal(actuator.funds, "none"); assert.equal("privateKey" in actuator, false); assert.equal("keystorePath" in actuator, false);
  const receipt = await actuator.transition({ authority: authorityReceipts(), rmnSemanticDigest: RMN, transition: { operation: "settleDemand", args: [`0x${"77".repeat(32)}`, "0x1234"] } });
  assert.equal(receipt.type, "Create"); assert.equal(receipt.object.type, "CloudEvent"); assert.equal(receipt.object.data.protocol, "A2A/RMN/UCAN/ERC-1271/ERC-4337/ERC-7677"); assert.equal(receipt.object.data.receipt.transactionHash, TX); assert.equal(userOperation.paymaster, "0x4444444444444444444444444444444444444444");
});

test("SXC-M7 refuses authority receipts that do not name the exact exchange transition", () => {
  const remoteSigner = { custody: "remote-cloud-kms-hsm", signUserOperationHash() {} };
  const actuator = createZeroCustodySemioticTransitionActuator({ bindingPath: "binding", rpcUrl: "http://rpc", bundlerUrl: "http://bundler", exchange: EXCHANGE, resource: RESOURCE, remoteSigner, paymaster: {}, admitAuthority: async (input) => input, policy: { account: ACCOUNT, selectors: [SETTLE_SELECTOR], rmnSemanticDigests: [RMN], maxGas: { callGasLimit: "0x1", verificationGasLimit: "0x1", preVerificationGas: "0x1", maxFeePerGas: "0x1", maxPriorityFeePerGas: "0x1" } } });
  const wrong = { with: RESOURCE, can: "semiotic-exchange/raise-demand", nb: {} };
  return assert.rejects(actuator.transition({ authority: authorityReceipts(wrong), rmnSemanticDigest: RMN, transition: { operation: "settleDemand", args: [`0x${"77".repeat(32)}`, "0x"] } }), /exact SemioticExchange transition/u);
});
