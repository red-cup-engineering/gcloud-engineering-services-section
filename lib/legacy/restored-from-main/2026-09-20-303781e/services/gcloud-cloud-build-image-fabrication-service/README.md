# Google Cloud Build image fabrication service

This package owns the provider-generic transaction from one admitted filesystem context to one immutable Artifact Registry image. It canonically remeasures every context file, binds the context to its verified `NodeRuntimeReleaseCatalogReceipt`, submits exactly one source-SHA-tagged Cloud Build, and accepts the result only when Cloud Build and Artifact Registry report the same image digest.

`fabricate-cloud-build-image` is the packaged CLI. It requires the context manifest and runtime release catalog receipt as separate inputs; customer packages retain their own package-wave, source-authorization, Scheduler, vulnerability, and promotion policies. `--evidence-destination` optionally writes the completed fabrication receipt through the injected immutable evidence-store authority and returns a generation-qualified custody pointer. The library itself has no ambient credentials or bucket policy.

The deployment-formation record law supplies stable context and request bytes. The runtime catalog keeps its producer-native SHA-256 receipt law, which is verified before its digest enters the context manifest.

The public `./build-config-carrier` export owns the smaller pure construction
boundary immediately before context materialization:

> one digest-pinned Cloud Build Docker builder plus one relative Dockerfile path
> → one deterministic, credential-free `cloudbuild.image.json` carrier.

The carrier performs one `docker build --pull`, names the immutable-source image
through the fixed `${_IMAGE}` substitution, declares that image as a Cloud Build
output, requires `VERIFIED` provenance, and uses Cloud Logging only. It contains
no project, repository, credentials, source SHA, or customer policy. The npm
container constructor owns the Dockerfile; this Google Cloud owner owns the
Cloud Build configuration; a deployment composer supplies both unchanged to the
generic context materializer.

The builder reference must include an explicit registry/repository and immutable
SHA-256 digest; implicit registry names are not admitted. Dockerfile and carrier
paths are normalized, substitution-free POSIX-relative paths and may not overlap.
The result exposes both its measured `carrier` identity and a `staticCarriers`
adapter containing the exact `{ path, mode, utf8 }` shape accepted by the generic
Node runtime container-image context materializer.

For the default root `Dockerfile`, the Docker invocation omits `--file`. For any
other admitted path it emits `--file <path>` before the fixed tag and context.
The release-authority verifier applies the same law. `authority.docker.path`
names the Dockerfile in the source repository; an optional
`authority.docker.contextPath` names that same admitted file after context
materialization and must equal the Cloud Build Dockerfile path. When omitted,
`contextPath` defaults to `docker.path`, preserving the original same-path law.

Cloud Build accepts JSON build configurations and treats `images` as the built
image output/push declaration. Google documents that `requestedVerifyOption:
VERIFIED` makes build success conditional on provenance and attestations, while
`CLOUD_LOGGING_ONLY` sends build logs to Cloud Logging rather than a Cloud
Storage logs bucket:

- [Cloud Build configuration schema](https://docs.cloud.google.com/build/docs/build-config-file-schema)
- [Build and store container images](https://docs.cloud.google.com/build/docs/building/build-containers)
- [Generate and validate build provenance](https://docs.cloud.google.com/build/docs/securing-builds/generate-validate-build-provenance)
