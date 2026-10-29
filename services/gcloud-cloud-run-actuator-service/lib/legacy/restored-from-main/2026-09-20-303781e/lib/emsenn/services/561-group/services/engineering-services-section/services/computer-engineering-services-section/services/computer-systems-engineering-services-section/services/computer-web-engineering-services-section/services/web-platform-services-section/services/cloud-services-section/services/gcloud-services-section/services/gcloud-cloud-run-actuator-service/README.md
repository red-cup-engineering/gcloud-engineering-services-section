# gcloud Cloud Run actuator service

This package owns bounded Cloud Run control-plane effects through the installed
Google Cloud SDK. It accepts typed library or CLI requests; it does not expose
an arbitrary `gcloud` argument membrane.

## Service staging and cutover

`deployCloudRunService` always stages a digest-pinned image with `--no-traffic`.
Its exact activity-request preimage includes the closed invocation admission
and every supplied revision setting the actuator can mutate: service account,
plain environment values, Secret Manager references, concurrency, CPU, memory,
network, subnetwork, VPC egress, timeout, maximum instances, and optional
revision tag. It also owns the optional revision minimum, execution environment,
CPU throttling, startup CPU boost, container port, HTTP startup/readiness/
liveness probes, ingress, and deploy-time startup health check supported by
gcloud 578. Boolean choices always emit an explicit positive or negative flag.
Omitted settings remain absent from both the request preimage and command rather
than being represented as invented defaults.

`admitCloudRunServiceStageReceipt` normalizes the corresponding Cloud Run v1
annotations/spec fields and v2 template/resource fields, rejects drift for every
supplied persistent setting, and proves the staged revision has no production
traffic. `deployHealthCheck` is not a persistent provider field: its exact value
is bound in the request/receipt, and successful `gcloud run deploy` is its effect
evidence. Secret values are never accepted or returned; only Secret Manager
name/version references cross this boundary.

`cutoverCloudRunService` remains a separate named-revision operation. Its
request must include a nonempty `originEnvironmentBindings` array of
environment names. Before assigning traffic, the actuator describes the named
revision, proves service ownership, and requires every named variable to equal
`canonicalOrigin`. The exact binding set and described revision are retained in
the receipt preimage/result. No provider-specific variable such as `BASE_URL`
is hardcoded by this generic actuator.

The corresponding public request projectors and receipt admitters are:

- `projectCloudRunServiceStageActivityRequest`
- `admitCloudRunServiceStageReceipt`
- `projectCloudRunServiceCutoverActivityRequest`
- `admitCloudRunServiceCutoverReceipt`
