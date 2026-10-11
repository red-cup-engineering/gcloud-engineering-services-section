import { Signature, recoverAddress } from "ethers";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/u;
function address(value, label) { if (typeof value !== "string" || !ADDRESS.test(value)) throw new TypeError(`${label} must be an EVM address`); return value.toLowerCase(); }
function bytes32(value, label) { if (typeof value !== "string" || !BYTES32.test(value)) throw new TypeError(`${label} must be bytes32`); return value.toLowerCase(); }
function derInteger(bytes, at) { if (bytes[at] !== 2) throw new Error("Cloud KMS signature is not DER ECDSA"); const size = bytes[at + 1]; const start = at + 2; if (size < 1 || start + size > bytes.length || bytes[start] === 0 && size > 1 && (bytes[start + 1] & 0x80) === 0) throw new Error("Cloud KMS DER integer is not canonical"); return { value: bytes.subarray(start, start + size), next: start + size }; }
function derSignatureToRs(der) { const bytes = Buffer.from(der); if (bytes[0] !== 0x30 || bytes[1] !== bytes.length - 2) throw new Error("Cloud KMS signature is not canonical DER"); const r = derInteger(bytes, 2); const s = derInteger(bytes, r.next); if (s.next !== bytes.length || r.value.length > 33 || s.value.length > 33) throw new Error("Cloud KMS signature has invalid secp256k1 width"); const pad = (value) => `0x${Buffer.concat([Buffer.alloc(32 - (value.length === 33 ? 32 : value.length)), value.length === 33 ? value.subarray(1) : value]).toString("hex")}`; return { r: pad(r.value), s: pad(s.value) }; }

/** Cloud KMS remote HSM signer. It accepts no key material; workload identity supplies the OAuth token. */
export function createGoogleCloudKmsSecp256k1Signer({ keyVersion, accessToken, expectedAddress, fetchImpl = fetch }) {
  if (!/^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+\/cryptoKeyVersions\/[^/]+$/u.test(keyVersion ?? "")) throw new TypeError("keyVersion must be a Cloud KMS CryptoKeyVersion resource");
  if (typeof accessToken !== "function") throw new TypeError("accessToken must be a workload-identity token provider");
  const signer = address(expectedAddress, "expected Cloud KMS signer address");
  return Object.freeze({
    custody: "remote-hsm", keyVersion, address: signer,
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
