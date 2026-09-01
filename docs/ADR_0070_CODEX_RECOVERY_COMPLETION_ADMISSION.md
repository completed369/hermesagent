# ADR-0070: Durable Codex recovery completion admission

Date: 2026-09-01

## Context

ADR-0069 defines independently observed exit evidence, but a service restart still leaves an expired
process-session claim unfinished. Normal owner completion must remain excluded while a recovery lease
is active, and recovery evidence must not be able to fabricate a successful runtime result.

## Decision

Add an append-only recovery-exit evidence table and one Level-3 control-plane admission method. In a
serializable transaction, the method locks the exact claim and recovery lease, revalidates the work
item and exit evidence against the database clock, reproduces the complete owner, supervisor,
dispatch, claim-window, and lease-window binding, and stores the exit evidence before one matching
process-session cleanup row.

The cleanup reason is fixed to `CANCELLED`. The database permits completion during an active recovery
lease only when an immutable matching recovery-exit row already exists and the lease remains current
at insertion time. Every other completion remains excluded by the active lease.

## Security and truth boundary

- Recovery completion performs no process discovery, signal, termination, retry, stream operation,
  secret resolution, provider call, deployment, or runtime-state transition.
- The database rejects cross-tenant, cross-owner, cross-claim, cross-generation, cross-supervisor,
  cross-launch, cross-session, cross-dispatch, stale-lease, late-exit, and non-cancellation drift.
- Exit evidence and cleanup are append-only. Replay must reproduce every trusted field and the same
  idempotency key.
- Recovery cleanup does not create authenticated cancellation protocol evidence and therefore cannot
  admit a terminal runtime message by itself.
- No positive production retained-identity source is supplied. Codex, Hermes, and Pi remain
  `NOT_CONFIGURED`.

## Consequences

An independently trusted future OS supervisor can close an abandoned durable claim without exposing
native authority to the control plane or claiming runtime success. Positive cleanup action, a
production retained-identity source, authenticated real-runtime traffic, and connected-state
promotion remain separate reviewed work.
