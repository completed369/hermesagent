# ADR 0013: Provider-neutral Agent Control Plane foundation

Status: Proposed

## Context

VentureOS issue #58 proposes a governed control plane for Codex, Hermes, Pi, and future runtimes.
The repository currently proves external engineering use of Codex and contains a pinned Pi CLI
harness. It does not prove that Codex, Hermes, or Pi is registered with VentureOS, authenticated as
a runtime, exchanging capabilities, sending heartbeats, or completing a task round-trip.

The collaboration release stack is changing the database schema. A parallel foundation must not
create migration conflicts or imply connectivity that does not exist.

## Decision

Introduce `@ventureos/agent-control-plane` as a provider-neutral TypeScript boundary containing:

- workspace-scoped agent, runtime, connection, capability, tool/grant, task/dependency, run,
  event, artifact, approval, heartbeat, usage, authority, and cost-limit contracts;
- a minimal runtime adapter interface for capability discovery and health plus one-use,
  policy-minted opaque dispatch/cancellation permits; the control plane validates and invokes the
  registered adapter without exposing a mutable validated payload to callers;
- a reference in-memory policy implementation for deterministic contract tests, not production
  persistence;
- evidence-derived connection status that requires one runtime-bound authenticated principal,
  correlated registration/capability/heartbeat/task/result records, and a fresh healthy heartbeat
  before `CONNECTED` is valid;
- workspace isolation, founder/planner task-creation authority, stored capability/tool/authority
  grants, runtime capability-exchange enforcement, one active run per task, atomic legal task/run
  transitions, concurrency limits, event/usage idempotency, UTF-8 bounded JSON payloads, and
  cumulative financial/compute limits;
- an allowlist of structured task kinds, fields, mandatory capabilities, tools, and exact scopes.
  Command, shell, script, argument-vector, empty-requirement, and unknown task shapes fail closed
  instead of being filtered by a fragile key denylist;
- runtime-principal ownership for run events and external-run binding, preventing cross-runtime
  telemetry or cancellation.
- claim-time revalidation of current runtime identity/health, run/task state, grants, capability
  exchange, exact tool scopes, authority, concurrency, and remaining budgets. Stale dispatch or
  cancellation permits are invalidated rather than trusted from an earlier check.

Runtime adapters receive exact structured, capability-scoped envelopes minted for one run and
claimed once by the authenticated connection principal. The control plane recursively freezes the
validated envelope and invokes the matching registered adapter immediately, so post-validation
mutation cannot raise authority, broaden scopes, or replace an external run ID. Telemetry and
task-ingestion APIs must never become a general shell, script, argument-vector, or
command-execution endpoint.
Adapter registration is authorizer-only and private to the control plane. Each permit binds the
exact registration generation and becomes stale if that adapter is replaced before execution.
Adapters must implement cancellation idempotently by external run ID: an ambiguous cancellation
failure consumes its one-use permit, but the control plane may mint a fresh revalidated permit for
the same external run. A bound run cannot become `CANCELLED` until adapter cancellation succeeds.
Even when an agent holds broader tool scopes, a validated adapter envelope contains only the one
scope required by the allowlisted task-kind policy.

## Verified runtime capability matrix

This matrix is the original discovery snapshot. ADR-0015 records the current
2026-08-21 interface verification and adapter decision. That later evidence
does not change any runtime's status: all remain `NOT_CONFIGURED` until
authenticated end-to-end proof exists.

| Runtime | Repository evidence                                                                                          | Control-plane status | Next proof required                                                                        |
| ------- | ------------------------------------------------------------------------------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------ |
| Codex   | Used through external Codex work sessions; no product-owned adapter or telemetry endpoint                    | `NOT_CONFIGURED`     | Authenticated adapter registration, capability exchange, heartbeat, task/result round-trip |
| Hermes  | Repository/project name and reserve-review documentation only; no callable interface evidenced               | `NOT_CONFIGURED`     | Verify a real API, CLI, MCP, service, or library before designing an adapter               |
| Pi      | Pinned `@earendil-works/pi-coding-agent@0.84.1` CLI engineering harness; explicitly not a production runtime | `NOT_CONFIGURED`     | Reviewed bridge identity plus authenticated heartbeat and structured task/result exchange  |

Installed software or repository naming is not connectivity evidence. Status changes must point to
observable audit evidence.

## Authority boundary

Authority levels are data, not self-authorization. Level 4 remains founder/authorized-human only
for consequential actions such as spending, contracts, production publication/deployment,
destructive changes, sensitive provider activation, or weakened security controls. A future
approval service must use existing deterministic VentureOS policy and audit services.

Credential fields contain references only. Raw secrets, private reasoning, and unrestricted
commands are outside this contract.

## Deferred dependencies

After the collaboration schema is stable, a follow-up PR should add:

1. Prisma persistence and migrations with compound workspace keys and foreign-key isolation;
2. authenticated, rate-limited, replay-protected API ingestion with bounded payloads;
3. immutable-content audit integration and approval-policy integration;
4. a generic bridge reference adapter before vendor-specific adapters;
5. Codex/Hermes/Pi adapters only after their real supported interfaces are verified;
6. SSE/WebSocket projections from authenticated stored events;
7. retention, deletion, evaluation, notification, incident, retry, lock, and scheduling models.

## Consequences

The control-plane vocabulary and security invariants can be reviewed now without touching the
release-critical database or application UI. The in-memory implementation is a test/reference
boundary only and must not be represented as durable production capability.
