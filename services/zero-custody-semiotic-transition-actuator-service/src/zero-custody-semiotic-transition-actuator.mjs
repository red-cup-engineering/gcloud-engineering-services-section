import { createHash } from "node:crypto";
import { Interface, Signature, recoverAddress } from "ethers";
import { executeEnterpriseUserOperation } from "@red-cup-engineering/ethereum-services-section/enterprise-user-operation";
import { observeEnterpriseAccountControllerBinding } from "@red-cup-engineering/ethereum-services-section/enterprise-account-controller-binding";
import { createUserOperationAuthorizationPolicy } from "@red-cup-engineering/ethereum-services-section/user-operation-authorization-policy";
import { verifyUcanInvocation } from "@red-cup-engineering/animating";

export const ACTOR_ID = "urn:ame:zero-custody-semiotic-transition-actuator-service";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/u;
const DID_PKH = /^did:pkh:eip155:([1-9][0-9]*):(0x[0-9a-fA-F]{40})$/u;
const NI = /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u;
const EXCHANGE = new Interface([
  "function seatCell(bytes carrier,bytes32 law)", "function retireCell(bytes32 cell)",
  "function raiseDemand(bytes carrier,bytes32 grounding,bytes32 wantedLaw)",
  "function offerDemand(bytes32 demand,bytes32 cell,bytes carrier)",
  "function purchaseMove(bytes32 demand,bytes32 offer)", "function settleDemand(bytes32 demand,bytes carrier)",
]);
const ACCOUNT = new Interface(["function executeRmn(bytes32 rmnSemanticDigest,(address target,uint256 value,bytes data)[] calls)"]);
const ABILITY = Object.freeze({ seatCell: "semiotic-exchange/seat-cell", retireCell: "semiotic-exchange/retire-cell",
  raiseDemand: "semiotic-exchange/raise-demand", offerDemand: "semiotic-exchange/offer-demand",
  purchaseMove: "semiotic-exchange/purchase-move", settleDemand: "semiotic-exchange/settle-demand" });

function address(value, label) { if (typeof value !== "string" || !ADDRESS.test(value)) throw new TypeError(`${label} must be an EVM address`); return value.toLowerCase(); }
function bytes32(value, label) { if (typeof value !== "string" || !BYTES32.test(value)) throw new TypeError(`${label} must be bytes32`); return value.toLowerCase(); }
function json(value) { return JSON.stringify(value, Object.keys(value).sort()); }
function selector(data) { return data.slice(0, 10).toLowerCase(); }
function derInteger(bytes, at) { if (bytes[at] !== 2) throw new Error("Cloud KMS signature is not DER ECDSA"); const size = bytes[at + 1]; const start = at + 2; if (size < 1 || start + size > bytes.length || bytes[start] === 0 && size > 1 && (bytes[start + 1] & 0x80) === 0) throw new Error("Cloud KMS DER integer is not canonical"); return { value: bytes.subarray(start, start + size), next: start + size }; }
function derSignatureToRs(der) { const bytes = Buffer.from(der); if (bytes[0] !== 0x30 || bytes[1] !== bytes.length - 2) throw new Error("Cloud KMS signature is not canonical DER"); const r = derInteger(bytes, 2); const s = derInteger(bytes, r.next); if (s.next !== bytes.length || r.value.length > 33 || s.value.length > 33) throw new Error("Cloud KMS signature has invalid secp256k1 width"); const pad = (value) => `0x${Buffer.concat([Buffer.alloc(32 - (value.length === 33 ? 32 : value.length)), value.length === 33 ? value.subarray(1) : value]).toString("hex")}`; return { r: pad(r.value), s: pad(s.value) }; }

/** Cloud KMS remote HSM signer. It accepts no key material; workload identity supplies the OAuth token. */
export function createGoogleCloudKmsSecp256k1Signer({ keyVersion, accessToken, expectedAddress, fetchImpl = fetch }) {
  if (!/^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+\/cryptoKeyVersions\/[^/]+$/u.test(keyVersion ?? "")) throw new TypeError("keyVersion must be a Cloud KMS CryptoKeyVersion resource");
  if (typeof accessToken !== "function") throw new TypeError("accessToken must be a workload-identity token provider");
  const signer = address(expectedAddress, "expected Cloud KMS signer address");
  return Object.freeze({
    custody: "remote-cloud-kms-hsm", keyVersion, address: signer,
    async signUserOperationHash(hash) {
      const digest = bytes32(hash, "UserOperation hash");
      const response = await fetchImpl(`https://cloudkms.googleapis.com/v1/${keyVersion}:asymmetricSign`, { method: "POST", headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" }, body: JSON.stringify({ digest: { sha256: Buffer.from(digest.slice(2), "hex").toString("base64") } }) });
      const body = await response.json(); if (!response.ok || typeof body.signature !== "string") throw new Error(`Cloud KMS asymmetricSign refused: ${body.error?.message ?? response.status}`);
      const { r, s } = derSignatureToRs(Buffer.from(body.signature, "base64"));
      for (const yParity of [0, 1]) { const signature = Signature.from({ r, s, yParity }).serialized; if (recoverAddress(digest, signature).toLowerCase() === signer) return signature; }
      throw new Error("Cloud KMS signature does not recover to the bound policy signer");
    },
  });
}

export function createErc7677TransitionPaymaster({ url, profile, law, fetchImpl = fetch }) {
  if (!/^https:\/\//u.test(url ?? "")) throw new TypeError("paymaster URL must be HTTPS");
  async function request(method, operation, entryPoint, chainId) { const response = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [operation, entryPoint, `0x${BigInt(chainId).toString(16)}`, { profile, law, customer: `eip155:${chainId}:${operation.sender}` }] }) }); const body = await response.json(); if (!response.ok || body.error) throw new Error(`ERC-7677 paymaster refused: ${body.error?.message ?? response.status}`); return body.result; }
  return Object.freeze({ stub: ({ operation, entryPoint, chainId }) => request("pm_getPaymasterStubData", operation, entryPoint, chainId), final: ({ operation, entryPoint, chainId }) => request("pm_getPaymasterData", operation, entryPoint, chainId) });
}

function exchangeCall(transition) {
  if (!transition || typeof transition !== "object" || typeof transition.operation !== "string") throw new TypeError("transition must name one SemioticExchange operation");
  const args = transition.args ?? [];
  const fragment = EXCHANGE.getFunction(transition.operation, args); if (!fragment) throw new TypeError("unknown SemioticExchange operation");
  return EXCHANGE.encodeFunctionData(fragment, args);
}
function admittedResourceReceipts(value) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError("one or more measured resource receipts are required");
  const receipts = value.map((receipt, index) => {
    if (receipt === null || typeof receipt !== "object" || Array.isArray(receipt) || Object.keys(receipt).length === 0) throw new TypeError(`resourceReceipts[${index}] must be one nonempty receipt object`);
    return structuredClone(receipt);
  });
  return Object.freeze(receipts);
}
function validateAuthorityReceipts({ ucanReceipt, bindingReceipt, resource, operation, rmnSemanticDigest }) {
  const did = DID_PKH.exec(resource); if (!did) throw new TypeError("resource must be did:pkh:eip155:<chainId>:<address>");
  if (ucanReceipt?.type !== "UcanInvocationVerificationReceipt" || ucanReceipt.version !== 1
    || ucanReceipt.disposition !== "authorized" || ucanReceipt.revocationStatus !== "active"
    || !NI.test(ucanReceipt.id ?? "") || !NI.test(ucanReceipt.capabilityNi ?? "")) {
    throw new Error("a current standards-conformant UCAN invocation receipt is required");
  }
  const capability = ucanReceipt.capability;
  if (!capability || capability.with?.toLowerCase() !== resource.toLowerCase()
    || capability.can !== ABILITY[operation] || !capability.nb || typeof capability.nb !== "object") {
    throw new Error("UCAN lacks the exact SemioticExchange transition capability over the account resource");
  }
  if (bindingReceipt?.type !== "EnterpriseAccountControllerBindingReceipt" || bindingReceipt.version !== 1
    || bindingReceipt.protocol !== "ERC-1271" || bindingReceipt.disposition !== "bound"
    || bindingReceipt.admissionPolicy !== "reverify-erc1271-and-userop-nonce-at-every-admission"
    || !NI.test(bindingReceipt.id ?? "") || !NI.test(bindingReceipt.capabilityNi ?? "")) {
    throw new Error("a finalized EnterpriseAccount controller binding receipt is required");
  }
  if (bindingReceipt.resource?.toLowerCase() !== resource.toLowerCase()
    || bindingReceipt.controller !== ucanReceipt.controller || bindingReceipt.actor !== ucanReceipt.actor
    || bindingReceipt.delegationCid !== ucanReceipt.delegationCid
    || bindingReceipt.invocationCid !== ucanReceipt.invocationCid
    || bindingReceipt.rmnSemanticDigest?.toLowerCase() !== rmnSemanticDigest
    || bindingReceipt.capabilityNi !== ucanReceipt.capabilityNi) {
    throw new Error("UCAN and EnterpriseAccount binding receipts do not qualify the same invocation context");
  }
  return Object.freeze({ resource: resource.toLowerCase(), controller: ucanReceipt.controller,
    actor: ucanReceipt.actor, delegationCid: ucanReceipt.delegationCid,
    invocationCid: ucanReceipt.invocationCid, ucanReceipt: ucanReceipt.id,
    controllerBindingReceipt: bindingReceipt.id });
}

/** Compose the two independent authority observations for one exact transition. */
export function createCanonicalSemioticTransitionAuthorityAdmission({ authority, controller, actor, isRevoked, rpc }) {
  if (typeof isRevoked !== "function" || typeof rpc !== "function") throw new TypeError("canonical authority admission requires live revocation and finalized-chain observers");
  return async ({ invocation, caveats = {}, binding, resource, operation, rmnSemanticDigest }) => {
    const did = DID_PKH.exec(resource ?? "");
    const can = ABILITY[operation];
    if (!did || can === undefined || binding === null || typeof binding !== "object") throw new TypeError("authority input does not name one exact SemioticExchange transition");
    const capability = Object.freeze({ with: resource.toLowerCase(), can, nb: Object.freeze(structuredClone(caveats)) });
    const ucanReceipt = await verifyUcanInvocation({ invocation, authority, controller, actor, capability, isRevoked });
    const bindingReceipt = await observeEnterpriseAccountControllerBinding({
      profile: "org.emsenn.evm.enterprise-account-controller-binding.v1", chain: `eip155:${did[1]}`,
      account: did[2], resource: resource.toLowerCase(), controller, actor,
      delegationCid: ucanReceipt.delegationCid, invocationCid: ucanReceipt.invocationCid, capability,
      rmnSemanticDigest, a2aCorrelation: binding.a2aCorrelation, userOpNonce: binding.userOpNonce,
      notBefore: binding.notBefore, expiration: binding.expiration, challengeNonce: binding.challengeNonce,
      signature: binding.signature, block: binding.block, blockHash: binding.blockHash,
    }, { rpc });
    return Object.freeze({ ucanReceipt, bindingReceipt });
  };
}

/** SXC-M7 composition: AP(CloudEvent(A2A(RMN))) -> UCAN -> ERC-7677 -> ERC-4337 -> SemioticExchange. */
export function createZeroCustodySemioticTransitionActuator({ bindingPath, rpcUrl, bundlerUrl, exchange, resource, remoteSigner, paymaster, policy, admitAuthority }) {
  const exchangeAddress = address(exchange, "SemioticExchange"); const did = DID_PKH.exec(resource ?? ""); if (!did) throw new TypeError("resource must be did:pkh");
  if (!remoteSigner || remoteSigner.custody !== "remote-cloud-kms-hsm" || typeof remoteSigner.signUserOperationHash !== "function") throw new TypeError("SXC-M7 requires a remote Cloud KMS HSM signer");
  if (typeof admitAuthority !== "function") throw new TypeError("SXC-M7 requires per-transition UCAN/revocation/ERC-1271 admission");
  if (!policy || !Array.isArray(policy.selectors) || policy.selectors.length === 0 || !Array.isArray(policy.rmnSemanticDigests) || policy.rmnSemanticDigests.length === 0 || !policy.maxGas) throw new TypeError("SXC-M7 policy must bound selectors, RMN digests, and gas");
  const allowedSelectors = new Set(policy.selectors.map((value) => /^0x[0-9a-fA-F]{8}$/u.test(value) ? value.toLowerCase() : (() => { throw new TypeError("policy selector is invalid"); })()));
  const allowedDigests = new Set(policy.rmnSemanticDigests.map((value) => bytes32(value, "policy RMN digest")));
  const gas = Object.fromEntries(["callGasLimit", "verificationGasLimit", "preVerificationGas", "maxFeePerGas", "maxPriorityFeePerGas"].map((field) => {
    const value = policy.maxGas[field]; if (!/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u.test(value ?? "")) throw new TypeError(`policy maxGas.${field} is invalid`); return [field, BigInt(value)];
  }));
  const authorization = createUserOperationAuthorizationPolicy({ chainId: Number(did[1]), account: address(policy.account, "policy account"), contracts: [address(policy.account, "policy account")], maxSignatures: policy.maxSignatures ?? 1 });
  return Object.freeze({
    custody: "none", funds: "none", persistence: "none",
    async transition({ authority, resourceReceipts, rmnSemanticDigest, transition: move }) {
      const calldata = exchangeCall(move); const digest = bytes32(rmnSemanticDigest, "RMN semantic digest");
      const measuredResources = admittedResourceReceipts(resourceReceipts);
      const admitted = await admitAuthority(Object.freeze({ ...authority, resource,
        operation: move.operation, rmnSemanticDigest: digest }));
      const admittedAuthority = validateAuthorityReceipts({ ucanReceipt: admitted?.ucanReceipt,
        bindingReceipt: admitted?.bindingReceipt, resource, operation: move.operation,
        rmnSemanticDigest: digest });
      const receipt = await executeEnterpriseUserOperation({ bindingPath, rpcUrl, bundlerUrl, target: exchangeAddress, calldata, rmnSemanticDigest: digest, signUserOperationHash: (hash) => remoteSigner.signUserOperationHash(hash), paymaster, authorizeUserOperation: ({ chainId, account, operation }) => {
        if (!allowedDigests.has(digest)) throw new Error("SXC-M7 policy refuses the RMN semantic digest");
        if (BigInt(operation.nonce) !== BigInt(admitted.bindingReceipt.userOpNonce)) throw new Error("controller binding receipt does not bind the current UserOperation nonce");
        for (const [field, ceiling] of Object.entries(gas)) if (BigInt(operation[field]) > ceiling) throw new Error(`SXC-M7 policy refuses ${field}`);
        const [effectDigest, calls] = ACCOUNT.decodeFunctionData("executeRmn", operation.callData);
        if (String(effectDigest).toLowerCase() !== digest || calls.length !== 1 || address(calls[0].target, "RMN call target") !== exchangeAddress || BigInt(calls[0].value) !== 0n || !allowedSelectors.has(selector(calls[0].data))) throw new Error("SXC-M7 policy refuses the bounded SemioticExchange call");
        return authorization.authorize({ chainId, contract: account, userOperation: { sender: operation.sender, nonce: operation.nonce, call_data: operation.callData, call_gas_limit: operation.callGasLimit, verification_gas_limit: operation.verificationGasLimit, pre_verification_gas: operation.preVerificationGas, max_fee_per_gas: operation.maxFeePerGas, max_priority_fee_per_gas: operation.maxPriorityFeePerGas, paymaster: operation.paymaster ?? "0x", paymaster_data: operation.paymasterData ?? "0x", ...(operation.paymasterVerificationGasLimit ? { paymaster_verification_gas_limit: operation.paymasterVerificationGasLimit } : {}), ...(operation.paymasterPostOpGasLimit ? { paymaster_post_op_gas_limit: operation.paymasterPostOpGasLimit } : {}) } });
      } });
      const event = { specversion: "1.0", cloudEventType: "org.emsenn.sxc.transition.settled.v1", source: ACTOR_ID, id: `ni:///sha-256;${createHash("sha256").update(json({ digest, resourceReceipts: measuredResources, userOpHash: receipt.userOpHash, transactionHash: receipt.transactionHash })).digest("base64url")}`, subject: resource, data: { protocol: "A2A/RMN/UCAN/ERC-1271/ERC-4337/ERC-7677", authority: admittedAuthority, rmnSemanticDigest: digest, resourceReceipts: measuredResources, transition: move.operation, selector: selector(calldata), receipt } };
      return Object.freeze({ "@context": "https://www.w3.org/ns/activitystreams", type: "Create", actor: ACTOR_ID, object: { type: "CloudEvent", ...event } });
    },
  });
}

/**
 * Narrow break-glass seam for a live, directly supplied Leader repair order.
 * It deliberately does not impersonate the normal UCAN/ERC-1271 admission:
 * the returned artifact says so, and callers must retain the direct request
 * and named work-order as its provenance.  The injected preparer is the same
 * locally-validating ERC-4337 builder used by the normal path; this seam never
 * owns either signing key or submits an outer transaction.
 */
export function createDirectLeaderEmergencyTransitionProjection({ directAuthority, workOrderPath, workOrderResultNi, demandNi, policySigner, prepare }) {
  if (directAuthority?.authorityClass !== "direct-leader-emergency" || directAuthority.ucanVerified !== false) throw new TypeError("an explicit direct-leader-emergency authority record is required");
  if (typeof directAuthority.requestProvenance !== "string" || directAuthority.requestProvenance.length === 0) throw new TypeError("direct emergency authority must retain request provenance");
  if (typeof workOrderPath !== "string" || !workOrderPath.endsWith("wo-services-obsmetrological-services-section-a1ba588a07fa.json")) throw new TypeError("the exact persisted work order is required");
  if (workOrderResultNi !== "ni:///sha-256;WCT8BY86qSKwgmDDbwiIrW2AHSmXHYK9bV_ZaxKgK54") throw new TypeError("the exact market-result NI is required");
  if (!NI.test(demandNi ?? "") || typeof prepare !== "function") throw new TypeError("demand identity and a local UserOperation preparer are required");
  const signer = address(policySigner, "transition policy signer");
  return Object.freeze({
    custody: "none", funds: "none", persistence: "none", authorityClass: "direct-leader-emergency", ucanVerified: false,
    async prepare(input) {
      const prepared = await prepare(Object.freeze({ ...input, policySigner: signer }));
      if (!prepared?.userOpHash || !prepared?.packedOperation || prepared?.policySigner?.toLowerCase() !== signer) throw new Error("emergency transition preparer did not return the bound signed UserOperation");
      return Object.freeze({
        type: "DirectLeaderEmergencyPreparedTransition", authorityClass: "direct-leader-emergency", ucanVerified: false,
        requestProvenance: directAuthority.requestProvenance, workOrderPath, workOrderResultNi, demandNi,
        transitionPolicySigner: signer, ucanReceipt: null, erc1271BindingReceipt: null, prepared,
      });
    },
  });
}
