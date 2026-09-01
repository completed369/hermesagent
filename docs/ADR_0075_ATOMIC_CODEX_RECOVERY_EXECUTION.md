# ADR-0075: Atomic Codex recovery execution operation

Date: 2026-09-02

## Context

ADR-0073 returns an active lease, work item, and durable dispatch atomically, while ADR-0074 binds
that bundle to a single execution authority. A future worker would still have to call lease
acquisition and construct the execution authority separately, leaving unnecessary room to
substitute caller-selected recovery metadata between those operations.

## Decision

Add one internal Level-3 operation that claims the durable recovery bundle and immediately binds the
exact returned lease, work item, and dispatch to the existing zero-input execution authority. The
caller supplies only the lease/claim idempotency identity and a separate completion idempotency key;
it cannot supply a work item or dispatch.

An expired idempotent lease replay returns frozen inert truth with no execution authority. An active
lease must include both validated work item and dispatch or the operation denies. The retained-native-
identity evidence source still denies by default. Durable replay truth is preserved in the result.

## Security and truth boundary

- The operation requires an already-issued Level-3 control-plane capability and exact owner binding.
- Lease acquisition remains serializable, database-clock-authoritative, owner-scoped, and append-only.
- No caller-selected metadata crosses the claim-to-execution boundary.
- The default evidence source cannot observe or complete recovery.
- The operation adds no inventory loop, timer, retry, native handle, process lookup, signal,
  termination, launch, stream, secret, provider, deployment, or runtime-state transition.
- Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

A future bounded worker can invoke one exact recovery attempt without receiving broad database
authority or assembling an executable bundle itself. Inventory scheduling, a positive OS-specific
retained-identity source, native cleanup action, and authenticated real-runtime traffic remain
separate reviewed work.
