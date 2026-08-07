import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { createCloudTasksMessageQueue, createGcsTransactionalOperationStore, createGoogleApiRequest, createGoogleOidcVerifier } from "../src/runtime-authorities.mjs";

function response(body, init = {}) { return new Response(body === undefined ? null : JSON.stringify(body), init); }
const operation = `ni:///sha-256;${"A".repeat(43)}`;

test("Cloud Tasks queue emits only custody identity, authenticates delivery, and dispatches Fedify's registered listener", async () => {
  const calls = [], custody = new Map(), controller = new AbortController();
  const queue = createCloudTasksMessageQueue({
    project: "project", location: "us-central1", queue: "fedify", targetUrl: "https://worker.example/queue", serviceAccountEmail: "worker@example.iam.gserviceaccount.com",
    custody: {
      async put(record) { custody.set(record.ni, record.bytes); },
      async get(ni) { const bytes = custody.get(ni); return bytes === undefined ? null : { bytes }; },
    },
    async authenticate(request) { return request.headers.get("authorization") === "Bearer verified"; },
    async request(url, init) { calls.push({ url, task: JSON.parse(init.body).task }); return response({}, { status: 200 }); },
  });
  const listening = queue.listen(async (message) => { assert.deepEqual(message, { type: "inbox", activity: { id: "https://origin.example/a" } }); }, { signal: controller.signal });
  await queue.enqueue({ type: "inbox", activity: { id: "https://origin.example/a" } });
  await queue.enqueue({ activity: { id: "https://origin.example/a" }, type: "inbox" });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].task.name, calls[1].task.name, "exact identity produces deterministic task name");
  assert.match(calls[0].task.name, /\/tasks\/fedify-[0-9a-f]{64}$/u, "Cloud Tasks name is lowercase hex only");
  const dispatched = JSON.parse(Buffer.from(calls[0].task.httpRequest.body, "base64url").toString("utf8"));
  assert.deepEqual(Object.keys(dispatched).sort(), ["correlation", "custody", "v"]);
  assert.equal(calls[0].task.httpRequest.oidcToken.audience, "https://worker.example/queue");
  await assert.rejects(() => queue.enqueue({ type: "inbox" }, { orderingKey: "actor:one" }), /does not support Fedify orderingKey/);
  assert.equal((await queue.consume(new Request("https://worker.example/queue", { method: "POST", body: JSON.stringify(dispatched) }))).status, 401);
  assert.equal((await queue.consume(new Request("https://worker.example/queue", { method: "POST", headers: { authorization: "Bearer verified" }, body: JSON.stringify(dispatched) }))).status, 204);
  custody.clear();
  assert.equal((await queue.consume(new Request("https://worker.example/queue", { method: "POST", headers: { authorization: "Bearer verified" }, body: JSON.stringify(dispatched) }))).status, 503, "immutable custody get(null) is a retryable missing message");
  controller.abort();
  await listening;
});

test("Cloud Tasks failure does not claim enqueue success", async () => {
  const queue = createCloudTasksMessageQueue({
    project: "project", location: "us-central1", queue: "fedify", targetUrl: "https://worker.example/queue", serviceAccountEmail: "worker@example.iam.gserviceaccount.com",
    custody: { async retain() {}, async retrieve() {} }, authenticate: async () => true,
    async request() { return response({}, { status: 503 }); },
  });
  await assert.rejects(() => queue.enqueue({ type: "inbox" }), /HTTP 503/);
});

test("duplicate Cloud Tasks names are reconciled against the exact provider task", async () => {
  let requested; const custody = new Map();
  const queue = createCloudTasksMessageQueue({
    project: "project", location: "us-central1", queue: "fedify", targetUrl: "https://worker.example/queue", serviceAccountEmail: "worker@example.iam.gserviceaccount.com",
    custody: { async put({ ni, bytes }) { custody.set(ni, bytes); }, async get(ni) { return custody.has(ni) ? { bytes: custody.get(ni) } : null; } }, authenticate: async () => true,
    async request(_url, init = {}) { if (init.method === "POST") { requested = JSON.parse(init.body).task; return response({}, { status: 409 }); } return response(requested); },
  });
  await queue.enqueue({ type: "inbox" });
  const conflicting = createCloudTasksMessageQueue({
    project: "project", location: "us-central1", queue: "fedify", targetUrl: "https://worker.example/queue", serviceAccountEmail: "worker@example.iam.gserviceaccount.com",
    custody: { async put() {}, async get() { return null; } }, authenticate: async () => true,
    async request(_url, init = {}) { if (init.method === "POST") return response({}, { status: 409 }); return response({ ...requested, httpRequest: { ...requested.httpRequest, body: "forged" } }); },
  });
  await assert.rejects(() => conflicting.enqueue({ type: "inbox" }), /occupied by a different task/);
});

test("delayed duplicate accepts provider schedule identity without comparing a regenerated wall clock", async () => {
  let existing, creates = 0;
  const custody = { async put() {}, async get() { return null; } };
  const queue = createCloudTasksMessageQueue({
    project: "project", location: "us-central1", queue: "fedify", targetUrl: "https://worker.example/queue", serviceAccountEmail: "worker@example.iam.gserviceaccount.com", custody, authenticate: async () => true,
    async request(_url, init = {}) {
      if (init.method === "POST" && creates++ === 0) { existing = JSON.parse(init.body).task; return response({}, { status: 200 }); }
      if (init.method === "POST") return response({}, { status: 409 });
      return response({ ...existing, scheduleTime: { seconds: "1700000010", nanos: 0 } });
    },
  });
  const delay = { total: () => 10 };
  await queue.enqueue({ type: "inbox" }, { delay });
  await queue.enqueue({ type: "inbox" }, { delay });
});

test("Cloud Tasks and GCS default paths exercise metadata ADC authorization", async () => {
  const calls = [], custody = new Map();
  const cloudFetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url === "http://metadata/token") return response({ access_token: "adc", expires_in: 3600 });
    if (url.includes("cloudtasks")) return response({}, { status: 200 });
    return response({ generation: "1" });
  };
  const options = { googleApiRequestOptions: { metadataUrl: "http://metadata/token", fetch: cloudFetch } };
  const queue = createCloudTasksMessageQueue({ ...options, project: "project", location: "us", queue: "queue", targetUrl: "https://worker.example/queue", serviceAccountEmail: "worker@example.iam.gserviceaccount.com", custody: { async put({ ni, bytes }) { custody.set(ni, bytes); }, async get() { return null; } }, authenticate: async () => true });
  await queue.enqueue({ type: "inbox" });
  const store = createGcsTransactionalOperationStore({ ...options, bucket: "bucket" });
  await store.compareAndSet(operation, null, { operation, state: "received" });
  assert.equal(calls.filter((call) => call.url === "http://metadata/token").length, 2, "each default authority acquires metadata ADC");
  assert.ok(calls.filter((call) => call.url !== "http://metadata/token").every((call) => call.init.headers.get("authorization") === "Bearer adc"));
});

test("GCS transactional store conforms to saga records and uses generation-match for concurrent compare-and-set", async () => {
  let generation = undefined, value = undefined;
  const store = createGcsTransactionalOperationStore({
    bucket: "operations", prefix: "txn/",
    async request(url, init = {}) {
      if (!init.method) {
        if (generation === undefined) return response({}, { status: 404 });
        if (url.includes("alt=media")) return response(value);
        return response({ generation });
      }
      assert.match(url, /ifGenerationMatch=/);
      const match = new URL(url).searchParams.get("ifGenerationMatch");
      if ((generation === undefined ? "0" : generation) !== match) return response({}, { status: 412 });
      value = JSON.parse(init.body);
      generation = String((Number(generation ?? "0") + 1));
      return response({ generation });
    },
  });
  assert.equal(await store.get(operation), undefined);
  const first = await store.compareAndSet(operation, null, { operation, state: "prepared", version: "caller-must-not-persist" });
  assert.deepEqual(first, { operation, state: "prepared", version: "1" });
  const observed = await store.get(operation);
  assert.deepEqual(observed, first);
  const [left, right] = await Promise.allSettled([store.compareAndSet(operation, observed.version, { operation, state: "left" }), store.compareAndSet(operation, observed.version, { operation, state: "right" })]);
  assert.equal([left, right].filter((result) => result.status === "fulfilled").length, 1, "only one concurrent provider precondition succeeds");
  await assert.rejects(() => store.compareAndSet(operation, observed.version, { operation, state: "stale" }), /stale expected version/);
});

test("GCS operation-store provider failures are visible", async () => {
  const store = createGcsTransactionalOperationStore({ bucket: "operations", async request() { return response({ error: { message: "denied" } }, { status: 403 }); } });
  await assert.rejects(() => store.get(operation), /HTTP 403/);
  await assert.rejects(() => store.compareAndSet(operation, null, { operation, state: "prepared" }), /HTTP 403: denied/);
});

test("Google API request uses only metadata ADC and caches its access token", async () => {
  const calls = []; let now = 1000;
  const request = createGoogleApiRequest({ metadataUrl: "http://metadata/token", now: () => now, fetch: async (url, init) => {
    calls.push({ url, init });
    if (url === "http://metadata/token") return response({ access_token: "workload-token", expires_in: 3600 });
    return response({}, { status: 200 });
  } });
  await request("https://cloudtasks.googleapis.com/v2/tasks", { headers: { "x-test": "1" } });
  await request("https://storage.googleapis.com/storage/v1/b/bucket");
  assert.equal(calls.filter((call) => call.url === "http://metadata/token").length, 1);
  assert.equal(calls[0].init.headers["Metadata-Flavor"], "Google");
  assert.equal(calls[1].init.headers.get("authorization"), "Bearer workload-token");
  now += 3_600_000;
  await request("https://storage.googleapis.com/storage/v1/b/bucket");
  assert.equal(calls.filter((call) => call.url === "http://metadata/token").length, 2);
  await assert.rejects(() => request("https://storage.googleapis.com/x", { headers: { authorization: "Bearer forged" } }), /must not override/);
});

function signedToken(privateKey, kid, claims) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const input = `${encode({ alg: "RS256", kid, typ: "JWT" })}.${encode(claims)}`;
  return `${input}.${sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url")}`;
}

test("Google OIDC verifier validates signature, issuer, audience, and exact task service account", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  let certificateRequests = 0; const now = 1_700_000_000_000;
  const verifier = createGoogleOidcVerifier({ audience: "https://worker.example/queue", serviceAccountEmail: "tasks@example.iam.gserviceaccount.com", now: () => now, fetch: async () => {
    certificateRequests += 1;
    return new Response(JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "google-key", use: "sig" }] }), { headers: { "cache-control": "public, max-age=300" } });
  } });
  const base = { iss: "https://accounts.google.com", aud: "https://worker.example/queue", email: "tasks@example.iam.gserviceaccount.com", email_verified: true, iat: now / 1000, exp: now / 1000 + 300 };
  const valid = signedToken(privateKey, "google-key", base);
  assert.equal(await verifier(new Request("https://worker.example/queue", { headers: { authorization: `Bearer ${valid}` } })), true);
  assert.equal(await verifier(new Request("https://worker.example/queue", { headers: { authorization: `Bearer ${signedToken(privateKey, "google-key", { ...base, email: "attacker@example.iam.gserviceaccount.com" })}` } })), false);
  assert.equal(await verifier(new Request("https://worker.example/queue", { headers: { authorization: `Bearer ${signedToken(privateKey, "google-key", { ...base, aud: "https://attacker.example" })}` } })), false);
  const [headerPart, claimPart, signaturePart] = valid.split(".");
  const tampered = `${headerPart}.${claimPart}.${signaturePart[0] === "A" ? "B" : "A"}${signaturePart.slice(1)}`;
  assert.equal(await verifier(new Request("https://worker.example/queue", { headers: { authorization: `Bearer ${tampered}` } })), false);
  assert.equal(certificateRequests, 1, "Google signing certificates are cached");
});
