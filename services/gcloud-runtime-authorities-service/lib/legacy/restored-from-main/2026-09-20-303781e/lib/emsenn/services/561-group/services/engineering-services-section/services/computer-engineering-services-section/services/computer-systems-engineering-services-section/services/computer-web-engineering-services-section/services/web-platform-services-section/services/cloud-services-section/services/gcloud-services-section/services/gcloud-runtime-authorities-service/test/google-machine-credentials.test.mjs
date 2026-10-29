import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, mock } from "node:test";
import { GoogleAuth } from "google-auth-library";
import { createGoogleApiRequest } from "../src/runtime-authorities.mjs";

test("explicit machine credential files use standard GoogleAuth for service and external accounts", async () => {
  const root = mkdtempSync(join(tmpdir(), "google-machine-"));
  const seen = [];
  const token = mock.method(GoogleAuth.prototype, "getAccessToken", async function () { seen.push(this.jsonContent.type); return "fixture-machine-token"; });
  try {
    for (const type of ["service_account", "external_account"]) {
      const file = join(root, type + ".json");
      writeFileSync(file, JSON.stringify({ type }), { mode: 0o600 });
      const request = createGoogleApiRequest({ credentialsFile: file, fetch: async (url, init) => {
        assert.equal(url, "https://cloudbilling.googleapis.com/v1/projects/123/billingInfo");
        assert.equal(init.headers.get("authorization"), "Bearer fixture-machine-token");
        return new Response("{}");
      } });
      assert.equal((await request("https://cloudbilling.googleapis.com/v1/projects/123/billingInfo")).status, 200);
    }
    assert.deepEqual(seen, ["service_account", "external_account"]);
  } finally { token.mock.restore(); rmSync(root, { recursive: true, force: true }); }
});

test("human or malformed credential files refuse without exposing retained secrets", () => {
  const root = mkdtempSync(join(tmpdir(), "google-human-"));
  try {
    const file = join(root, "credentials.json");
    writeFileSync(file, JSON.stringify({ type: "authorized_user", refresh_token: "private-fixture" }));
    assert.throws(() => createGoogleApiRequest({ credentialsFile: file }), error => /requires service_account or external_account/.test(error.message) && !error.message.includes("private-fixture"));
    writeFileSync(file, "private-fixture malformed");
    assert.throws(() => createGoogleApiRequest({ credentialsFile: file }), error => /unreadable or malformed/.test(error.message) && !error.message.includes("private-fixture"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("explicit injected tokens retain precedence and machine token failures are redacted", async () => {
  const request = createGoogleApiRequest({ credentialsFile: "/missing/credentials", accessToken: async () => "injected", fetch: async (_url, init) => new Response(init.headers.get("authorization")) });
  assert.equal(await (await request("https://example.invalid")).text(), "Bearer injected");
  const root = mkdtempSync(join(tmpdir(), "google-failure-"));
  const token = mock.method(GoogleAuth.prototype, "getAccessToken", async () => { throw new Error("private-fixture"); });
  try {
    const file = join(root, "credentials.json");writeFileSync(file, JSON.stringify({ type: "service_account" }));
    const failing = createGoogleApiRequest({ credentialsFile: file, fetch: async () => { throw new Error("unexpected API traffic"); } });
    await assert.rejects(failing("https://example.invalid"), error => error.message === "Google machine credential token acquisition unavailable");
  } finally { token.mock.restore(); rmSync(root, { recursive: true, force: true }); }
});
