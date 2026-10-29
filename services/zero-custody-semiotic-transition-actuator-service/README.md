# Zero-custody Semiotic transition actuator

SXC-M7 is the narrow transition face: it converts an authorized
`ActivityPub(CloudEvent(A2A(RMN)))` request into one bounded
`SemioticExchange` ERC-4337 UserOperation.  It carries neither a private key
nor funds nor durable runner state.

Deployment and invocation use the parent `gcloud-cloud-run-actuator-service`;
this service intentionally does not duplicate Cloud Run deployment logic.
The boundary remains separate because that generic carrier is entrusted with a
Cloud Run deployment capability token, while this actuator is entrusted only
with a remote KMS signing capability and bounded exchange/payer policy.

Fabricate the package through the semiotic-voxel package registry and
materialize its runtime from an explicitly admitted source catalog.  A pnpm
workspace link is development convenience only and is not release admission.
