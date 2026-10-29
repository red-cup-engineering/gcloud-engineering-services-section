#!/usr/bin/env node

// One-shot, development-chain-only gas distributor.  The treasury key stays in
// Cloud KMS; this process only asks KMS to sign exact, bounded native transfers.
import { JsonRpcProvider, Signature, Transaction, recoverAddress } from "ethers";

const CHAIN = 5615611;
const TREASURY = "0xdf3a1e5c40e3519479eda5a41cbdfc36e09b8ab9";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const required = (name) => { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; };
const derToRs = (base64) => {
  const der = Buffer.from(base64, "base64"); let offset = 2;
  if (der[0] !== 0x30 || der[1] !== der.length - 2) throw new Error("KMS returned malformed DER signature");
  const integer = () => { if (der[offset++] !== 2) throw new Error("KMS DER field is malformed"); const length = der[offset++]; const value = der.subarray(offset, offset + length); offset += length; if (!length || length > 33 || (length > 1 && value[0] === 0 && !(value[1] & 0x80))) throw new Error("KMS DER integer is noncanonical"); return length === 33 ? value.subarray(1) : value; };
  const r = integer(), s = integer(); if (offset !== der.length) throw new Error("KMS DER has trailing data");
  return { r: `0x${Buffer.concat([Buffer.alloc(32 - r.length), r]).toString("hex")}`, s: `0x${Buffer.concat([Buffer.alloc(32 - s.length), s]).toString("hex")}` };
};
const input = JSON.parse(required("DEVCHAIN_FUNDING_JSON"));
if (input.type !== "DevchainHsmTreasuryFunding" || input.chain !== `eip155:${CHAIN}` || !Array.isArray(input.transfers) || input.transfers.length < 1 || input.transfers.length > 4) throw new Error(`one bounded eip155:${CHAIN} funding manifest (1-4 transfers) is required`);
const rpcUrl = required("CHAIN_RPC_URL"); const keyVersion = required("TREASURY_KMS_KEY_VERSION");
if (!/^projects\/five-six-one-group-dev\/locations\/us-central1\/keyRings\/zero-custody-semiotic\/cryptoKeys\/a5615611-gas-treasury\/cryptoKeyVersions\/1$/u.test(keyVersion)) throw new Error("only the dedicated treasury key is admitted");
const provider = new JsonRpcProvider(rpcUrl, CHAIN); if (Number((await provider.getNetwork()).chainId) !== CHAIN) throw new Error(`refuse a chain other than eip155:${CHAIN}`);
const token = async () => (await (await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "metadata-flavor": "Google" } })).json()).access_token;
const seen = new Set(); const receipts = [];
let nonce = await provider.getTransactionCount(TREASURY, "pending"); const fee = await provider.getFeeData(); const gasPrice = fee.gasPrice ?? 1n;
for (const transfer of input.transfers) {
  if (!ADDRESS.test(transfer?.to ?? "") || seen.has(transfer.to.toLowerCase()) || !/^[1-9][0-9]*$/u.test(transfer?.wei ?? "")) throw new Error("each transfer needs a unique address and positive decimal wei amount");
  seen.add(transfer.to.toLowerCase()); const value = BigInt(transfer.wei); if (value > 100000000000000000n) throw new Error("each development funding transfer is capped at 0.1 ETH");
  const draft = Transaction.from({ type: 0, chainId: CHAIN, nonce: nonce++, to: transfer.to, value, gasLimit: 21000n, gasPrice });
  const digest = draft.unsignedHash; const response = await fetch(`https://cloudkms.googleapis.com/v1/${keyVersion}:asymmetricSign`, { method: "POST", headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" }, body: JSON.stringify({ digest: { sha256: Buffer.from(digest.slice(2), "hex").toString("base64") } }) });
  const body = await response.json(); if (!response.ok || !body.signature) throw new Error(`treasury KMS refused signing: ${body.error?.message ?? response.status}`);
  const { r, s } = derToRs(body.signature); let signature;
  for (const yParity of [0, 1]) { const candidate = Signature.from({ r, s, yParity }).serialized; if (recoverAddress(digest, candidate).toLowerCase() === TREASURY) { signature = candidate; break; } }
  if (!signature) throw new Error("treasury KMS signature does not recover to its declared address");
  draft.signature = Signature.from(signature); const hash = await provider.broadcastTransaction(draft.serialized).then((tx) => tx.hash); const receipt = await provider.waitForTransaction(hash, 1, 60_000); if (!receipt || receipt.status !== 1) throw new Error(`funding transaction failed: ${hash}`);
  receipts.push({ to: transfer.to, wei: transfer.wei, transactionHash: hash, blockNumber: receipt.blockNumber });
}
process.stdout.write(`${JSON.stringify({ type: "DevchainHsmTreasuryFundingReceipt", chain: `eip155:${CHAIN}`, treasury: TREASURY, receipts })}\n`);
