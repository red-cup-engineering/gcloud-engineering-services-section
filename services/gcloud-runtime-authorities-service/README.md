# GCloud runtime authorities

`createCloudTasksMessageQueue()` is a Fedify `MessageQueue`: attach it as the
`queue` passed to `serveActivityPubProvider`.  At worker boot, Fedify calls
`queue.listen(handler)` as part of `federation.startQueue()`; that call merely
registers the handler.  The Cloud Run/HTTP route serving the configured
`targetUrl` must call `queue.consume(request)`.  There is no polling process.
By default, `consume()` uses `createGoogleOidcVerifier()` to cryptographically
verify Google's cached JWKs, issuer, audience, expiry, and exact service-account
`email` claim.  A custom `authenticate` remains available only when another
authenticated ingress boundary is intentionally supplied.

The queue hashes the exact Fedify message plus its admitted delay request,
retains that immutable envelope through the supplied network custody adapter,
and gives Cloud Tasks only `{v,custody,correlation}`.  Task names use a
lowercase SHA-256 hex digest. On a duplicate name, the adapter reads the
existing provider task and accepts it only when URL, custody-only body,
correlation, OIDC account/audience, and scheduled-vs-immediate identity match.
The custody body commits the exact relative Fedify delay, so retries do not
incorrectly compare regenerated absolute wall-clock schedule timestamps. Cloud Tasks
receives an OIDC target token.
Cloud Tasks does not natively enforce Fedify's `orderingKey`; this adapter fails
closed when that option is supplied.  It is therefore suitable only for Fedify
flows that do not request per-key ordering until a separately configured,
provider-proven ordered queue is supplied.

`createGoogleApiRequest()` obtains and caches a Cloud Run/Compute metadata
server ADC access token. Both Cloud Tasks and GCS adapters use it by default;
`request` is only an explicit test/custom transport seam. It never invokes
`gcloud` or reads developer credentials.

`createGcsTransactionalOperationStore()` conforms directly to the induction
saga contract: `get(key)` returns `null` or a record whose top-level opaque
`version` is the GCS generation; `compareAndSet(key, expectedVersion|null,
record)` returns the stored record and rejects stale generations. Caller
`version` is stripped before storage. Its concurrency authority is explicitly
the GCS JSON API's provider-side `ifGenerationMatch` precondition. It uses
neither local files nor R2.

Pass the existing `immutable-content-custody-service` directly as `custody`:
the adapter maps `put({ni,bytes,mediaType})` and `get(ni)?.bytes` to its queue
boundary, preserving returned bytes exactly and treating `get(...) === null` as
missing custody. The old `{retain,retrieve}` shape is only a compatibility seam.
This service does not duplicate custody with another GCS surface.
