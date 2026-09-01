# ADR-0066: Codex process-session completion trust closure

Date: 2026-09-01

## Context

Process-session completion rows are the durable prerequisite for later terminal validation evidence.
Their foreign key preserves the claim identity, but the database did not independently constrain the
reported close time to the claim window. Idempotent service replay also checked only three identity
aliases and the completion reason, so a pre-existing poisoned row could be returned without
revalidating the complete persisted cleanup binding.

## Decision

Audit every existing completion during migration and reject installation if any row lacks its exact
claim, differs from the claim's dispatch binding or runtime truth, reports a close outside the claim
window, reports a close after its database creation time, or has a future creation time.

For every new insert, lock the exact claim row and repeat those checks at the database boundary. Fix
the completion creation timestamp to the database's millisecond transaction clock. At the service
boundary, idempotent replay must compare every persisted identity, process result, close time,
runtime-truth value, evidence hash, and idempotency key with the newly validated request.

## Security and truth boundary

- Completion remains append-only and is still rejected while an exclusive recovery lease is active.
- This adds no process launch, signal, termination, retry, transport, secret access, provider call,
  terminal admission, usage recognition, cost, or deployment.
- The cleanup evidence hash remains owner-reported integrity evidence. The database cannot infer
  independent OS-process ownership or recompute that hash from private process state.
- Runtime truth remains `NOT_CONFIGURED`; Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

Later recovery composition can no longer inherit a completion row whose persisted cleanup fields or
time authority differ from its trusted claim. A positive recovery owner, OS-bound cleanup proof,
authenticated real-runtime round trip, and runtime truth promotion remain separate work.
