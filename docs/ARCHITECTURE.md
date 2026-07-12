# Architecture

## Style

Modular monolith (NestJS API) with a separate Temporal workflow worker
process, per master spec section 10. No microservices, no custom workflow
engine.

```
apps/web (Next.js)  --HTTP/cookies-->  apps/api (NestJS)  --Prisma-->  PostgreSQL
                                            |
                                            |--> MinIO (via @ventureos/integrations)
                                            |
                                            +--> Temporal (via @ventureos/workflows client)
                                                       |
                                                  apps/worker (Temporal Worker)
```

## Module boundaries (apps/api/src/modules)

`auth`, `workspaces`, `onboarding`, `audit`, `security`, `health` today.
Phase 2+ will add `opportunities`, `evidence`, `proposals`, `board`,
`approvals`, `policies`, `products`, `listings`, `finance`, `experiments`,
`integrations`, `notifications` as their own modules, each with a
service/controller pair and its own DB models — no shared "god service".

## External providers behind interfaces

Core business logic never imports a specific AI provider, marketplace,
image provider, email provider, analytics provider, or storage provider
directly. Phase 1 demonstrates this with `StorageProvider`
(`packages/integrations/src/storage/types.ts`): `MinioStorageProvider` for
real use, `MockStorageProvider` for tests, both implementing the same
interface. The same pattern will be used for the AI provider (Phase 3) and
marketplace adapters (Phase 4/6).

## Why a modular monolith, not microservices

Single founder, single workspace, small team (of one), tight budget
(§4/§19). Microservices would add operational overhead (multiple deploys,
network calls, distributed tracing) with no corresponding benefit at this
scale. Revisit only if/when multi-tenant SaaS (Phase 8) demands independent
scaling of specific modules.

## Server-side authorization, always

Every sensitive route uses `SessionAuthGuard` (resolves a real DB session on
every request) and, where relevant, `PermissionGuard` + `@RequirePermission`
(RBAC checked against a live DB-backed role/permission join, not a JWT claim
that could go stale). The frontend never assumes an action is allowed
because a button is visible — see `apps/web/src/lib/api.ts` comment.

## Data flow for approvals (Phase 3+, architected now)

`@ventureos/contracts` defines `isApprovalValidForExecution()`: any
execution step must re-check that the approval's bound artifact version AND
package hash still match the current artifact, and that the approval has
not expired — server-side, inside the workflow, not just in the UI. This
function is unit-tested now even though nothing calls it yet, so the
contract is locked in before Phase 3 builds on top of it.
