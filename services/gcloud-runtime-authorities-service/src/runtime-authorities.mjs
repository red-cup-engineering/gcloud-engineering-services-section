import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";

const TASKS_ROOT = "https://cloudtasks.googleapis.com/v2/";
const STORAGE_ROOT = "https://storage.googleapis.com/storage/v1/";
const UPLOAD_ROOT = "https://storage.googleapis.com/upload/storage/v1/";
const NI_PREFIX = "ni:///sha-256;";

function requiredText(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function requiredFunction(value, label) {
  if (typeof value !== "function") throw new TypeError(`${label} must be a function`);
  return value;
}

function base64url(bytes) { return Buffer.from(bytes).toString("base64url"); }
function sha256(text) { return createHash("sha256").update(text).digest("base64url"); }
function sha256Hex(text) { return createHash("sha256").update(text).digest("hex"); }

const GOOGLE_METADATA_TOKEN = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
const GOOGLE_OIDC_CERTS = "https://www.googleapis.com/oauth2/v3/certs";

/**
 * Produces an authenticated Google API request function using only the Cloud
 * Run/Compute metadata server's application-default workload identity.  It
 * never runs gcloud and never reads a developer credential file.
 */
export function createGoogleApiRequest(options = {}) {
  const metadataUrl = options.metadataUrl ?? GOOGLE_METADATA_TOKEN;
  const request = requiredFunction(options.fetch ?? fetch, "Google API fetch");
  const now = options.now ?? (() => Date.now());
  let accessToken, expiresAt = 0;
  return async function googleApiRequest(url, init = {}) {
    if (accessToken === undefined || now() >= expiresAt - 60_000) {
      const response = await request(metadataUrl, { headers: { "Metadata-Flavor": "Google" } });
      if (!response.ok) throw new Error(`Google ADC metadata token failed with HTTP ${response.status}`);
      const token = await response.json();
      if (typeof token.access_token !== "string" || token.access_token === "" || !Number.isFinite(token.expires_in) || token.expires_in <= 0) {
        throw new Error("Google ADC metadata token response is malformed");
      }
      accessToken = token.access_token;
      expiresAt = now() + token.expires_in * 1000;
    }
    const headers = new Headers(init.headers);
    if (headers.has("authorization")) throw new TypeError("Google API request must not override workload authorization");
    headers.set("authorization", `Bearer ${accessToken}`);
    return request(url, { ...init, headers });
  };
}

function jwtPart(token, index) {
  const part = token.split(".")[index];
  if (typeof part !== "string") throw new TypeError("OIDC bearer token must be a compact JWT");
  try { return JSON.parse(Buffer.from(part, "base64url").toString("utf8")); } catch { throw new TypeError("OIDC bearer token contains invalid JSON"); }
}

function cacheLifetime(response) {
  const match = /max-age=(\d+)/u.exec(response.headers.get("cache-control") ?? "");
  return Math.max(60, Number(match?.[1] ?? 300)) * 1000;
}

/** Cryptographically verifies a Cloud Tasks Google OIDC delivery token. */
export function createGoogleOidcVerifier(options) {
  if (options === null || typeof options !== "object") throw new TypeError("Google OIDC verifier options are required");
  const audience = requiredText(options.audience, "Google OIDC audience");
  const serviceAccountEmail = requiredText(options.serviceAccountEmail, "Google OIDC service account email");
  const request = requiredFunction(options.fetch ?? fetch, "Google OIDC certificate fetch");
  const certsUrl = options.certsUrl ?? GOOGLE_OIDC_CERTS;
  const now = options.now ?? (() => Date.now());
  let certificates = new Map(), certificatesExpireAt = 0;

  async function keys() {
    if (now() < certificatesExpireAt) return certificates;
    const response = await request(certsUrl);
    if (!response.ok) throw new Error(`Google OIDC certificate discovery failed with HTTP ${response.status}`);
    const document = await response.json();
    if (!Array.isArray(document.keys)) throw new Error("Google OIDC certificate response has no JWK keys");
    const next = new Map(document.keys.filter((key) => key?.kid && key.kty === "RSA" && key.use === "sig").map((key) => [key.kid, key]));
    if (next.size === 0) throw new Error("Google OIDC certificate response has no signing keys");
    certificates = next;
    certificatesExpireAt = now() + cacheLifetime(response);
    return certificates;
  }

  return async function verifyGoogleOidc(requestToWorker) {
    const authorization = requestToWorker.headers.get("authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) return false;
    const token = authorization.slice("Bearer ".length);
    const pieces = token.split(".");
    if (pieces.length !== 3) return false;
    let header, claims;
    try { header = jwtPart(token, 0); claims = jwtPart(token, 1); } catch { return false; }
    if (header.alg !== "RS256" || typeof header.kid !== "string") return false;
    const key = (await keys()).get(header.kid);
    if (!key) return false;
    try {
      if (!verifySignature("RSA-SHA256", Buffer.from(`${pieces[0]}.${pieces[1]}`), createPublicKey({ key, format: "jwk" }), Buffer.from(pieces[2], "base64url"))) return false;
    } catch { return false; }
    const seconds = Math.floor(now() / 1000), skew = 60;
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(audience)
        || !["accounts.google.com", "https://accounts.google.com"].includes(claims.iss)
        || claims.email !== serviceAccountEmail || claims.email_verified !== true
        || !Number.isFinite(claims.exp) || claims.exp <= seconds - skew
        || (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > seconds + skew))
        || (claims.iat !== undefined && (!Number.isFinite(claims.iat) || claims.iat > seconds + skew))) return false;
    return true;
  };
}

// Fedify messages are JSON carriers.  Deliberately reject values whose JSON
// representation is ambiguous rather than assigning two messages one task.
function canonicalJson(value, seen = new Set()) {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("runtime message must contain only finite JSON numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError("runtime message must not be cyclic");
    seen.add(value);
    const result = `[${value.map((item) => canonicalJson(item, seen)).join(",")}]`;
    seen.delete(value);
    return result;
  }
  if (typeof value === "object") {
    if (seen.has(value)) throw new TypeError("runtime message must not be cyclic");
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError("runtime message must contain only JSON objects");
    seen.add(value);
    const result = `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], seen)}`).join(",")}}`;
    seen.delete(value);
    return result;
  }
  throw new TypeError("runtime message must contain only JSON values");
}

function durationSeconds(delay) {
  if (delay === undefined) return undefined;
  if (delay === null || typeof delay !== "object") throw new TypeError("Fedify delay must be a Temporal.Duration");
  try {
    const seconds = delay.total({ unit: "seconds" });
    if (!Number.isFinite(seconds) || seconds < 0) throw new TypeError("Fedify delay must be non-negative and time-only");
    return seconds;
  } catch (error) {
    if (error instanceof TypeError && error.message.startsWith("Fedify delay")) throw error;
    throw new TypeError("Fedify delay must be a time-only Temporal.Duration");
  }
}

function scheduleTime(seconds) {
  if (seconds === undefined || seconds === 0) return undefined;
  const millis = Date.now() + Math.round(seconds * 1000);
  return { seconds: String(Math.floor(millis / 1000)), nanos: (millis % 1000) * 1_000_000 };
}

function taskFailure(response, operation) {
  return new Error(`Cloud Tasks ${operation} failed with HTTP ${response.status}`);
}

function sameTask(existing, requested) {
  const actual = existing?.httpRequest;
  const expected = requested.httpRequest;
  // Fedify gives a relative delay; Date.now() turns it into an absolute time
  // during each enqueue attempt. The custody payload commits that exact delay,
  // so reconciliation can prove scheduled-vs-immediate but must not compare an
  // unreproducible wall-clock timestamp on a legitimate retry.
  const schedulesMatch = requested.scheduleTime === undefined
    ? existing?.scheduleTime === undefined
    : typeof existing?.scheduleTime?.seconds === "string"
      && Number.isInteger(existing.scheduleTime.nanos) && existing.scheduleTime.nanos >= 0 && existing.scheduleTime.nanos < 1_000_000_000;
  return existing?.name === requested.name
    && actual?.httpMethod === expected.httpMethod
    && actual?.url === expected.url
    && actual?.body === expected.body
    && actual?.oidcToken?.serviceAccountEmail === expected.oidcToken.serviceAccountEmail
    && actual?.oidcToken?.audience === expected.oidcToken.audience
    && schedulesMatch;
}

function custodyAdapter(custody) {
  if (typeof custody?.put === "function" && typeof custody?.get === "function") {
    return Object.freeze({
      retain: async ({ identity, mediaType, bytes }) => custody.put({ ni: identity, mediaType, bytes }),
      retrieve: async (identity) => {
        const retained = await custody.get(identity);
        if (retained === null || retained === undefined) return undefined;
        if (!retained || !Buffer.isBuffer(retained.bytes)) throw new TypeError("immutable custody get must return { bytes } or null");
        return retained.bytes;
      },
    });
  }
  if (typeof custody?.retain === "function" && typeof custody?.retrieve === "function") return custody;
  throw new TypeError("Cloud Tasks queue requires immutable custody { put, get } or legacy { retain, retrieve } adapters");
}

/**
 * Creates Fedify's MessageQueue adapter.  `custody.retain` and
 * `custody.retrieve` are a separately purchased immutable network custody
 * boundary; Cloud Tasks never receives the Fedify message itself.
 *
 * `listen()` is registration, not a daemon: register it during worker boot.
 * Route the Cloud Tasks HTTP target to `consume(request)`.  `authenticate`
 * must verify the task's Google-signed OIDC bearer token, including issuer,
 * audience, and service-account subject.  A non-2xx consume response makes
 * Cloud Tasks retry; no process polls for work.
 */
export function createCloudTasksMessageQueue(options) {
  if (options === null || typeof options !== "object") throw new TypeError("Cloud Tasks queue options are required");
  const project = requiredText(options.project, "Cloud project");
  const location = requiredText(options.location, "Cloud Tasks location");
  const queue = requiredText(options.queue, "Cloud Tasks queue");
  const targetUrl = new URL(requiredText(options.targetUrl, "Cloud Tasks target URL"));
  if (targetUrl.protocol !== "https:") throw new TypeError("Cloud Tasks target URL must use HTTPS");
  const serviceAccountEmail = requiredText(options.serviceAccountEmail, "Cloud Tasks OIDC service account");
  const audience = requiredText(options.audience ?? targetUrl.href, "Cloud Tasks OIDC audience");
  const request = requiredFunction(options.request ?? createGoogleApiRequest(options.googleApiRequestOptions), "authenticated Cloud Tasks request");
  const immutableCustody = custodyAdapter(options.custody);
  const authenticate = options.authenticate === undefined
    ? createGoogleOidcVerifier({ ...(options.oidcVerifierOptions ?? {}), audience, serviceAccountEmail })
    : requiredFunction(options.authenticate, "Cloud Tasks worker OIDC authentication");
  const parent = `projects/${project}/locations/${location}/queues/${queue}`;
  let handler;

  async function enqueue(message, enqueueOptions = {}) {
    // Cloud Tasks has no per-message ordering-key primitive.  Accepting this
    // option would silently weaken Fedify's contract, so this adapter narrows
    // its supported surface and refuses it rather than inventing a lock.
    if (enqueueOptions.orderingKey !== undefined) throw new TypeError("Cloud Tasks MessageQueue does not support Fedify orderingKey; configure an ordered provider before using it");
    const delay = durationSeconds(enqueueOptions.delay);
    const envelope = canonicalJson({ message, ...(delay === undefined ? {} : { delay }) });
    const digest = sha256(envelope), taskDigest = sha256Hex(envelope);
    const custody = `${NI_PREFIX}${digest}`;
    await immutableCustody.retain(Object.freeze({ identity: custody, mediaType: "application/vnd.fedify.message+json", bytes: Buffer.from(envelope, "utf8") }));
    const correlation = `urn:fedify:cloud-tasks:${digest}`;
    const scheduled = scheduleTime(delay);
    const task = {
      name: `${parent}/tasks/fedify-${taskDigest}`,
      httpRequest: {
        httpMethod: "POST",
        url: targetUrl.href,
        headers: { "content-type": "application/json" },
        body: base64url(JSON.stringify({ v: 1, custody, correlation })),
        oidcToken: { serviceAccountEmail, audience },
      },
      ...(scheduled === undefined ? {} : { scheduleTime: scheduled }),
    };
    const response = await request(`${TASKS_ROOT}${parent}/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task }) });
    if (!response.ok && response.status === 409) {
      // A deterministic name is only idempotent after the provider confirms
      // that its existing task is precisely this immutable dispatch.
      const existingResponse = await request(`${TASKS_ROOT}${task.name}`);
      if (!existingResponse.ok) throw taskFailure(existingResponse, "read existing");
      if (!sameTask(await existingResponse.json(), task)) throw new Error("Cloud Tasks deterministic name is occupied by a different task");
      return;
    }
    if (!response.ok) throw taskFailure(response, "create");
  }

  async function consume(requestToWorker) {
    if (await authenticate(requestToWorker, Object.freeze({ audience, serviceAccountEmail })) !== true) return new Response("unauthenticated Cloud Tasks delivery", { status: 401 });
    if (requestToWorker.method !== "POST") return new Response("method not allowed", { status: 405 });
    let receipt;
    try { receipt = JSON.parse(await requestToWorker.text()); } catch { return new Response("invalid task receipt", { status: 400 }); }
    if (receipt?.v !== 1 || typeof receipt.custody !== "string" || !receipt.custody.startsWith(NI_PREFIX) || typeof receipt.correlation !== "string") {
      return new Response("invalid task receipt", { status: 400 });
    }
    if (handler === undefined) return new Response("Fedify listener is not registered", { status: 503 });
    const retained = await immutableCustody.retrieve(receipt.custody);
    if (retained === undefined) return new Response("immutable custody not found", { status: 503 });
    const envelope = Buffer.from(retained).toString("utf8");
    const digest = sha256(envelope);
    if (receipt.custody !== `${NI_PREFIX}${digest}` || receipt.correlation !== `urn:fedify:cloud-tasks:${digest}`) return new Response("custody correlation mismatch", { status: 400 });
    let parsed;
    try { parsed = JSON.parse(envelope); } catch { return new Response("invalid retained message", { status: 503 }); }
    await handler(parsed.message);
    return new Response(null, { status: 204 });
  }

  return Object.freeze({
    nativeRetrial: true,
    enqueue,
    async enqueueMany(messages, enqueueOptions) { await Promise.all(messages.map((message) => enqueue(message, enqueueOptions))); },
    async listen(nextHandler, listenOptions = {}) {
      handler = requiredFunction(nextHandler, "Fedify queue listener");
      // Fedify starts listen() on boot.  There is intentionally nothing to
      // poll; Cloud Tasks invokes consume() over the authenticated HTTP route.
      if (listenOptions.signal?.aborted) { handler = undefined; return; }
      await new Promise((resolve) => {
        listenOptions.signal?.addEventListener("abort", () => { handler = undefined; resolve(); }, { once: true });
      });
    },
    consume,
  });
}

function objectName(key, prefix) {
  if (typeof key !== "string" || !/^ni:\/\/\/sha-256;[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u.test(key)) throw new TypeError("transaction key must be one canonical SHA-256 ni URI");
  return `${prefix}${encodeURIComponent(key)}`;
}

async function readError(response) {
  try { return await response.json(); } catch { return undefined; }
}

/**
 * An async operation store whose CAS authority is GCS's server-side
 * `ifGenerationMatch` precondition.  It has no local cache or filesystem
 * fallback: 412 is the provider's authoritative concurrent-write result.
 */
export function createGcsTransactionalOperationStore(options) {
  if (options === null || typeof options !== "object") throw new TypeError("GCS operation store options are required");
  const bucket = requiredText(options.bucket, "GCS bucket");
  const prefix = options.prefix === undefined ? "operations/" : requiredText(options.prefix, "GCS object prefix");
  const request = requiredFunction(options.request ?? createGoogleApiRequest(options.googleApiRequestOptions), "authenticated GCS request");

  async function get(key) {
    const name = objectName(key, prefix);
    const metadata = await request(`${STORAGE_ROOT}b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(name)}`);
    if (metadata.status === 404) return undefined;
    if (!metadata.ok) throw new Error(`GCS operation get metadata failed with HTTP ${metadata.status}`);
    const descriptor = await metadata.json();
    if (typeof descriptor.generation !== "string" || descriptor.generation === "") throw new Error("GCS operation metadata did not contain a generation");
    const content = await request(`${STORAGE_ROOT}b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(name)}?alt=media&generation=${encodeURIComponent(descriptor.generation)}`);
    if (!content.ok) throw new Error(`GCS operation get content failed with HTTP ${content.status}`);
    const body = await content.json();
    if (body === null || typeof body !== "object" || Array.isArray(body) || Object.hasOwn(body, "version")) throw new Error("GCS operation content is malformed");
    return Object.freeze({ ...body, version: descriptor.generation });
  }

  async function compareAndSet(key, expectedVersion, record) {
    const name = objectName(key, prefix);
    const generation = expectedVersion === undefined || expectedVersion === null ? "0" : requiredText(expectedVersion, "expected GCS generation");
    if (record === null || typeof record !== "object" || Array.isArray(record)) throw new TypeError("operation record must be a JSON object");
    const persisted = Object.fromEntries(Object.entries(record).filter(([key]) => key !== "version"));
    const url = `${UPLOAD_ROOT}b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(name)}&ifGenerationMatch=${encodeURIComponent(generation)}`;
    const response = await request(url, { method: "POST", headers: { "content-type": "application/json" }, body: canonicalJson(persisted) });
    if (response.status === 412 || response.status === 404) throw new Error("GCS operation compareAndSet rejected stale expected version");
    if (!response.ok) {
      const detail = await readError(response);
      throw new Error(`GCS operation compareAndSet failed with HTTP ${response.status}${detail?.error?.message ? `: ${detail.error.message}` : ""}`);
    }
    const written = await response.json();
    if (typeof written.generation !== "string" || written.generation === "") throw new Error("GCS operation write did not return a generation");
    return Object.freeze({ ...persisted, version: written.generation });
  }

  return Object.freeze({ authority: "GCS JSON API ifGenerationMatch", get, compareAndSet });
}
