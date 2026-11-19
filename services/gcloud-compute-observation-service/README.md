# gcloud-compute-observation-service

<!-- 561-group-standards:badges:start -->
[![Red Cup Engineering](https://img.shields.io/badge/561%20Group-Red%20Cup%20Engineering-c0392b)](https://github.com/red-cup-engineering)
[![License: MIT](https://img.shields.io/badge/license-MIT-c0392b)](LICENSE)
[![Indigenous data: CARE](https://img.shields.io/badge/Indigenous%20data-CARE-4b6f44)](https://github.com/red-cup-engineering/.github/blob/main/GOVERNANCE.md)
[![Tips welcome](https://img.shields.io/badge/tips-welcome-d4a017)](https://github.com/561-group/.github/blob/main/TIPS.md)
<!-- 561-group-standards:badges:end -->

Read-only Google Cloud compute inventory through an injected native command boundary.

## Scoped serverless inventory

observeGoogleCloudComputeResources({cloudRunRegion}, {jsonCommand}) lists
Cloud Run services, Cloud Run jobs, Cloud Functions and storage buckets
as separate observed resources for each visible project. Jobs and functions
are restricted to the explicitly selected region; this is not a claim
about any other region. The host supplies the native gcloud command boundary;
the observer does not acquire credentials, select a provider account, deploy,
execute jobs or route Work.

A listed job/function is a configuration observation, not proof of usable
remaining quota, an invocation grant, zero-cash eligibility, or successful
task execution. A project listing is not evidence that any particular local
authenticated account may invoke every resource in that project. Enabled
APIs, IAM permissions, billing, account entitlements, service readiness and
actual execution must be independently qualified by their existing owners.
Explicit not-enabled, unavailable and observed empty inventories remain
different states. Project-level provider responses are reduced to typed
coordinates without carrying arbitrary credential/configuration fields.
