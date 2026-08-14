# Architecture

## Style

Modular monolith (NestJS API) with a separate Temporal workflow worker
process, per master spec section 10. No microservices, no custom workflow
engine.

```
apps/web (Next.js)  --HTTP/cookies-->  apps/api (NestJS)  --Prisma-->  PostgreSQL
                                            |
                                            +--> Temporal (via @ventureos/workflows client)
                                                       |
                                                  apps/worker (Temporal Worker)

apps/api and apps/worker  ---->  StorageProvider abstraction  ---->  MinIO or mock storage
```

## Module boundaries (apps/api/src/modules)

The API is organized as domain modules with controller/service pairs rather
than a shared "god service". At the current repository state those modules
include authentication and platform foundations (`auth`, `workspaces`,
`onboarding`, `audit`, `security`, `health`) plus later-phase domains that now
exist in source (`opportunities`, `board`, `approvals`, `products`,
`marketplace`, `research`, `finance`, `ventures`, `billing`).

Repository source shows these modules are implemented in code. Operational
readiness still depends on the relevant validation layer: local development
verification, GitHub CI, the local/container staging gate, and any separately
approved external deployment evidence.

## External providers behind interfaces

Core business logic does not import a specific AI provider, marketplace,
image provider, email provider, analytics provider, or storage provider
directly. Provider-shaped integrations sit behind package boundaries and
fail-closed policy checks. Current implemented commercial provider paths remain
mock/disabled unless explicitly configured and allowed by backend policy:
non-mock AI providers, real Etsy publication, payments, advertising, email, and
other sensitive external actions are not established as live by repository
source alone.

Phase 1 demonstrated the pattern with `StorageProvider`
(`packages/integrations/src/storage/types.ts`): `MinioStorageProvider` for
configured storage use and `MockStorageProvider` for tests/mock modes, both
implementing the same interface. Both API paths and worker product-generation
activities can use this storage abstraction. Later packages follow the same
boundary pattern for research, product generation, marketplace, billing, and
agent/runtime paths.

## Why a modular monolith, not microservices

Single founder, tight budget, and founder-controlled operations (§4/§19) make
a modular monolith the correct default. Microservices would add operational
overhead (multiple deploys, network calls, distributed tracing) without a
corresponding current benefit. Revisit only if a later, founder-approved SaaS
or workload-scaling need demands independent scaling of specific modules.

## Server-side authorization, always

Every sensitive route uses `SessionAuthGuard` (resolves a real DB session on
every request) and, where relevant, `PermissionGuard` + `@RequirePermission`
(RBAC checked against a live DB-backed role/permission join, not a JWT claim
that could go stale). The frontend never assumes an action is allowed because a
button is visible; every sensitive backend restriction must be enforced in
deterministic backend code.

## Data flow for approvals

`@ventureos/contracts` defines `isApprovalValidForExecution()`: execution steps
must re-check that the approval's bound artifact version and package hash still
match the current artifact, and that the approval has not expired. That contract
is now used by implemented board, product/listing, publication, and scale
approval paths.

This is an implemented backend/workflow control, not a frontend-only display.
It is still distinct from production readiness: real-provider side effects
remain gated/disabled unless a future founder-approved integration supplies the
additional provider-specific controls and operational evidence.
