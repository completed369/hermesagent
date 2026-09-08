# Agent Control Plane delivery evidence

## Purpose

This matrix reconciles the deliverables in GitHub issue #58 with repository evidence after merged
PRs #252 and #253. It distinguishes implemented contracts from real runtime activation. A file,
unit test, synthetic process fixture, or green CI run can prove a contract, but none can prove that
Codex, Hermes, or Pi is connected without the authenticated end-to-end evidence required by
ADR-0015.

## Delivery matrix

| Issue #58 deliverable                                                                                       | Repository evidence                                                                                                                                                      | Status                                      | Truth boundary                                                                                           |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Schema and migrations                                                                                       | `packages/database/prisma/schema.prisma`; durable ACP migrations beginning with `20260825120000_acp_task_run_spine` and `20260825190000_durable_agent_bridge_foundation` | Implemented                                 | Durable records do not prove a live runtime.                                                             |
| Service and API layer                                                                                       | `apps/api/src/modules/agent-control-plane`; `apps/api/src/modules/workflow-centre`                                                                                       | Implemented                                 | Services remain tenant-, capability-, approval-, and policy-scoped.                                      |
| Runtime adapter interface                                                                                   | `packages/agent-control-plane/src/contracts.ts`; `runtime-broker.ts`; `packages/agent-bridge/src`                                                                        | Implemented                                 | Production launcher, provider access, and positive secret transport remain deny-only.                    |
| Codex, Hermes, and Pi interface design                                                                      | `ADR_0015_RUNTIME_INTERFACE_EVIDENCE.md`                                                                                                                                 | Implemented                                 | Interface discovery and installed binaries are not connectivity evidence.                                |
| First bounded adapter                                                                                       | `ADR_0048_BOUNDED_CODEX_VALIDATION_RUNTIME_ADAPTER.md`; `packages/agent-bridge/src/codex-validation-runtime-adapter.ts`                                                  | Contract implemented; activation incomplete | Deterministic/injected evidence retains `providerAccess` and `runtimeConnection` as `NOT_CONFIGURED`.    |
| Task, run, event, artifact, and approval spine                                                              | ADR-0019 through ADR-0021; `apps/api/src/modules/agent-control-plane/acp-task-run.service.ts`; durable audit/event records                                               | Implemented                                 | No path can decide a Founder-only Level-4 approval.                                                      |
| Runtime registration, capabilities, heartbeat, dispatch, result, cancellation, and usage evidence contracts | Durable migrations and services under `packages/agent-bridge` and `apps/api/src/modules/agent-control-plane`; ADR-0048 and its successor ADRs                            | Implemented as bounded evidence contracts   | Synthetic or uncomposed evidence cannot promote a connection to `CONNECTED`.                             |
| Authentication, isolation, replay, bounds, and idempotency tests                                            | Unit and PostgreSQL integration suites under `packages/agent-bridge`, `packages/agent-control-plane`, and `apps/api/test`                                                | Implemented and CI-enforced                 | Tests prove rejection/contract behavior, not possession of production identities or credentials.         |
| Workflow Centre read model                                                                                  | ADR-0028; `apps/api/src/modules/workflow-centre`; `apps/web/src/app/dashboard/workflows`                                                                                 | Implemented                                 | Read-only projection exposes no execution or approval authority.                                         |
| SSE live telemetry                                                                                          | ADR-0171; `GET /api/workflow-centre/telemetry`; controller, service, integration, and browser tests                                                                      | Implemented                                 | It projects allowlisted persisted-event metadata only; keepalives are `SSE_TRANSPORT_ONLY`.              |
| Progress dashboard integration contract                                                                     | `apps/web/src/app/dashboard/workflows/workflow-telemetry-refresh.tsx` and page/E2E tests                                                                                 | Implemented                                 | The client refreshes the authoritative snapshot and never interprets a notification as runtime liveness. |
| Runbooks and limitations                                                                                    | `ROADMAP.md`, `KNOWN_LIMITATIONS.md`, ADR-0015, ADR-0048, ADR-0171                                                                                                       | Implemented and maintained                  | Deployment and activation instructions do not grant deployment or activation authority.                  |

## Evidence still required for a real connection

For each runtime, retain one independently reviewable chain that satisfies every acceptance item in
ADR-0015:

1. unique tenant-scoped runtime, connection, environment, and service-principal registration;
2. authenticated registration using an approved secret reference or workload identity;
3. rejected replay of registration and task material;
4. capability exchange filtered against the connection grants;
5. accepted sequenced heartbeat plus rejected stale or duplicate heartbeat;
6. one allowlisted task bound to a validated single-use permit;
7. correlated start, progress/status, and terminal result or artifact evidence;
8. observed usage/cost metadata, or an explicit supported absence;
9. cancellation with a terminal auditable state and rejection of later spoofed evidence; and
10. a persisted registration-to-result chain that contains no credentials, prompts, unrestricted
    commands, private reasoning, or cross-tenant data.

None of those chains exists for Codex, Hermes, or Pi. Their product status therefore remains
`NOT_CONFIGURED`.

## Activation boundary

The remaining Codex activation path is not another protocol wrapper. ADR-0159 through ADR-0164
complete the inactive API/worker carrier compositions up to the point where deployment-specific
inputs must be selected. Activation requires approved production identities and principal mapping,
owner-only native module and socket paths, reviewed immutable native artifacts, signer/root and
private-key custody, scoped runtime/provider credentials, and explicit API/worker lifecycle wiring.
Those inputs can create processes, establish credentialed connections, and mutate a deployed
environment. They require a separate exact-source Founder authorization and deployment review.

Hermes and Pi follow only after one runtime completes this acceptance path without weakening the
shared tenant, replay, approval, secret, tool, time, concurrency, cancellation, audit, and budget
boundaries.
