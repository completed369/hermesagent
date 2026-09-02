# ADR-0081: Durable retained-native supervisor trust state

Date: 2026-09-02

## Context

ADR-0080 defines signed, fresh, revocable supervisor trust snapshots and a supervisor-instance-
scoped compare-and-swap checkpoint port. Without a durable implementation, rollback resistance does
not survive API restarts and root-signer rotation could be implemented incorrectly as a parallel
signer-scoped history.

## Decision

Add uncomposed PostgreSQL adapters and migration-backed state:

- the reader is constructed for exactly one supervisor instance and returns only its highest stored
  snapshot version; absence, ambiguity, malformed input, and database failure deny;
- immutable snapshot rows contain public trust material only, enforce an exact top-level JSON shape,
  bind database columns to the signed body, and limit validity to 15 minutes;
- one checkpoint row per supervisor instance carries the current root signer inside the same chain;
- bootstrap is insert-if-absent, while updates compare every expected snapshot, signer, active-key,
  fingerprint, trust-record, and version field with null-safe equality;
- a database trigger independently binds every checkpoint field to the exact referenced snapshot,
  enforces adjacent version advancement, blocks adjacent same-key fingerprint substitution and
  trust-record rollback, and prevents deletion; and
- every successful bootstrap or update appends immutable bounded reference/hash audit evidence.

An explicit null record produces a checkpoint with all active fields null. The database therefore
persists revocation without storing a key and prevents a stale active checkpoint from being restored.

## Security and runtime-truth boundary

- There is no snapshot writer, publication route, root provisioner, private-key custodian, or
  ambient credential source.
- The adapters use parameterized SQL only and expose no network, process, provider, deployment,
  publication, spend, task-dispatch, or status-transition behavior.
- No API module, worker, scheduler, recovery worker, or native peer constructs these positive
  adapters. Production remains deny-wired.
- Database rows are trust inputs, not evidence of a live authenticated runtime exchange. Codex,
  Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

The signed trust lifecycle can now survive restarts with database-enforced monotonicity and audit
evidence once an explicit composition root supplies a positive reader and store. The next safe slice
is a bounded composition that reads fresh trust immediately before and after the recovery exchange;
authenticated Linux local IPC remains required before production worker composition.
