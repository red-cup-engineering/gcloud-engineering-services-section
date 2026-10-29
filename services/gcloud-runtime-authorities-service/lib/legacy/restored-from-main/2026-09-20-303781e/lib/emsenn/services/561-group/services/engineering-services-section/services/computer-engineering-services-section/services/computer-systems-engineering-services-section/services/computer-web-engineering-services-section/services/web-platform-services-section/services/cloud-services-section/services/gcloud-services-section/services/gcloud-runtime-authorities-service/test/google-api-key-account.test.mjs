import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { observeGoogleApiKeyAccount } from "../src/runtime-authorities.mjs";

test("account observation follows authoritative key parent and reports billing without the key resource", async () => {
  const urls = [], secret = "fixture-only-key";
  const result = await observeGoogleApiKeyAccount({ apiKey: secret }, { now: () => 0, request: async (url) => {
    urls.push(url);
    return new Response(JSON.stringify(url.includes("lookupKey")
      ? { parent: "projects/12345/locations/global", name: "private-key-resource" }
      : { billingEnabled: false, billingAccountName: "" }));
  } });
  assert.equal(urls.length, 2);
  assert.equal(urls[1], "https://cloudbilling.googleapis.com/v1/projects/12345/billingInfo");
  assert.equal(result.accountIdentity, "projects/12345");
  assert.equal(result.billingEnabled, false);
  assert.equal(result.billingAccountBound, false);
  assert.equal(result.credentialSha256, createHash("sha256").update(secret).digest("hex"));
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(JSON.stringify(result).includes("private-key-resource"), false);
});

test("paid billing is reported as paid rather than converted to free entitlement", async () => {
  const result = await observeGoogleApiKeyAccount({ apiKey: "fixture" }, { request: async (url) =>
    new Response(JSON.stringify(url.includes("lookupKey") ? { parent: "projects/123/locations/global" } : { billingEnabled: true, billingAccountName: "billingAccounts/fixture" })) });
  assert.equal(result.billingEnabled, true);
  assert.equal(result.billingAccountBound, true);
  assert.equal(Object.hasOwn(result, "cashCost"), false);
});

test("unknown billing or a failed provider observation refuses with redacted diagnostics", async () => {
  for (const request of [
    async () => { throw Error("https://example.invalid/?keyString=fixture-secret"); },
    async () => new Response("{}", { status: 403 }),
    async (url) => new Response(JSON.stringify(url.includes("lookupKey") ? { parent: "projects/123/locations/global" } : {})),
    async () => new Response(JSON.stringify({ parent: "projects/not-numeric/locations/global" })),
  ]) await assert.rejects(observeGoogleApiKeyAccount({ apiKey: "fixture-secret" }, { request }), error =>
    error.message === "Google API credential account/billing observation unavailable" && !String(error).includes("fixture-secret"));
});
