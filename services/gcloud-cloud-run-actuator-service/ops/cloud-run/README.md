# GCloud Cloud Run Actuator carrier

This deploys the actuator as a publicly reachable Cloud Run actor. Its agent card is at `/.well-known/agent-card.json`, its ActivityPub service identity at `/actor`, and its A2A JSON-RPC interface at `/a2a`.

The actor carries no application database or object-store state. Every completed operation returns one JSONL Activity receipt for federation. Shared economic/ordering commitments can be anchored separately on `eip155:5615610`.

Prerequisites are a billing-enabled project and an Artifact Registry Docker repository named `union-actuators` (or `ARTIFACT_REPOSITORY`). Then run:

```bash
GOOGLE_CLOUD_PROJECT=project-id ACTUATOR_CAPABILITY_TOKEN=high-entropy-secret ./ops/cloud-run/deploy.sh
```

The carrier is public so federation discovery can reach it. Read-only discovery needs no secret. Deployment and invocation require the separately custodied high-entropy value in `X-Actuator-Capability`; it is not multiplexed into Cloud Run IAM's `Authorization` header.
