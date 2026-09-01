# ADR-0067: Lease-bound Codex recovery work items

Date: 2026-09-01

## Context

ADR-0065 made expired process-session claims exclusively leaseable, but the lease response contained
only lease identity and timing. A future recovery composition would have to reuse a separately read
inventory snapshot to obtain the supervisor and dispatch binding. That split creates unnecessary
staleness between authority acquisition and the immutable identity supplied to an injected owner.

## Decision

Return one deeply frozen recovery work item in the same serializable transaction that acquires or
actively replays a recovery lease. The work item reproduces the exact immutable claim's handoff,
dispatch, session, supervisor binding, original claim window, lease generation, and lease window.
The supervisor binding is revalidated before it is returned.

An expired lease replay or a replay whose claim already has completion returns its historical lease
but a `null` work item. Only an unfinished lease that is active according to the database clock can
yield an actionable metadata snapshot.

## Security and truth boundary

- The work item contains no PID, process handle, stream, payload, transcript, prompt, credential,
  secret, provider response, or arbitrary command material.
- It does not launch, inspect, signal, terminate, retry, complete cleanup, dispatch, or call a
  provider. A future injected owner must independently resolve the opaque supervisor identity and
  enforce the lease deadline before and after any action.
- A reusable PID alone is not acceptable recovery authority. Native retained-handle or equivalent
  supervisor proof remains required.
- Runtime truth remains `NOT_CONFIGURED`; Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

A later recovery owner receives one atomically authorized, immutable identity instead of composing a
lease with stale inventory. Recovery action, OS-bound exit proof, recovery-specific completion,
authenticated real-runtime traffic, and runtime truth promotion remain separate work.
