# ADR-0025: test-only process-tree cancellation evidence

Status: Accepted and implemented as test-only evidence (PR #86)

Date: 2026-08-26

This status records the dated reviewed implementation. It is not a mutable
current-main pointer or a production-runtime claim.

## Context

The pure OS-supervision admission policy intentionally cannot create or cancel
a process. Moving directly to a production launcher would combine executable
identity, operating-system isolation, process lifecycle, cancellation, and
runtime connectivity in one unsafe change.

## Decision

Add a pure supervisor lifecycle contract and a deterministic test-only
process-tree cancellation harness:

- lifecycle identity is bound to the exact workspace, runtime, connection,
  admission hashes, platform, supervision ID, and launch nonce;
- cancellation requires the exact binding, an idempotency reference, and one of
  a small fixed set of redacted reason codes;
- lifecycle transitions are explicit and terminal states cannot reopen;
- the harness launches only `process.execPath` with a repository-owned fixed
  fixture path and fixed arguments, never caller-controlled executables or
  argv;
- the fixture requires an explicit test-only marker, uses a bounded JSON
  handshake, and contains no runtime adapter, provider, credential, transport,
  API, database, or status path;
- local Windows evidence terminates the exact bounded descendant PID set from
  the nonce-bound fixture handshake, while the existing Linux CI path tests
  process-group TERM-to-KILL escalation; and
- an unrelated sentinel must survive, every recorded fixture descendant must
  exit, repeated cancellation is harmless, and cleanup runs on failure.

The actual fixture and process API imports live under `scripts/`, outside
`@ventureos/agent-bridge` source, exports, build output, and final images.
`DenyRuntimeProcessLauncher` remains the only production launcher
implementation and still rejects every request.

## Security boundary

This evidence does not establish a production process supervisor. Numeric PIDs
are not durable identities and may be reused. Windows production requires a
reviewed Job Object/no-breakaway and race-safe opened-handle design. Linux
production requires reviewed descriptor identity, non-root execution,
process-group or cgroup cleanup, and namespace/container isolation. Both need
bounded pipes, resource enforcement, crash cleanup, exact executable identity
through launch, and durable audit integration.

Codex, Hermes, and Pi remain `NOT_CONFIGURED`. Test fixture execution is not an
authenticated runtime registration, heartbeat, task exchange, or result/event
round trip.

## Consequences

The repository gains repeatable evidence that its cancellation semantics and a
fixed deterministic fixture behave on Windows and Linux. Production process
creation, filesystem evidence, secret backends, real transports, provider
activation, deployment, and runtime status changes remain separate changes.
