# ADR-0053: Durable executable-authority trust state

Status: Accepted (storage adapters present; positive authority remains unconfigured)

## Context

ADR-0051 defined a signed, short-lived executable-authority trust snapshot and a signer-scoped
atomic checkpoint port. ADR-0052 made the supervisor obtain that trust freshly before authorization
and native handoff. An in-memory checkpoint cannot prove anti-rollback across process restarts, and a
reader without durable signed input cannot support reviewed production composition.

## Decision

VentureOS now has PostgreSQL-backed implementations of the snapshot-reader and checkpoint-store
ports plus migration-enforced storage:

- signed snapshots are append-only and selected by the highest stored version for one constructor-
  bound signer;
- exact snapshot metadata, JSON shape, a maximum 15-minute interval, and bounded identifiers/digests
  are constrained in PostgreSQL, while Ed25519 and embedded-record verification remains in the
  Agent Bridge cryptographic source;
- a checkpoint can bootstrap once or advance only through an exact expected-value update;
- the checkpoint row is foreign-key-bound to the exact persisted signer/version/id/hash tuple;
- PostgreSQL enforces `old version + 1`, rejects checkpoint deletion, and writes an append-only audit
  event for every successful bootstrap or transition; and
- concurrent compare-and-swap attempts have exactly one winner.

This is platform security state, not workspace runtime evidence. It is intentionally global because
the trusted executable signer registry governs the host runtime boundary across tenants. Tenant-
scoped manifests, authorizations, process bindings, sessions, and runtime evidence remain separately
validated and cannot be promoted by these tables.

The adapters accept an explicit database dependency and signer key identifier. They read no
filesystem, environment, network endpoint, credential, or ambient configuration. No snapshot-write
API, controller, provider registration, root record, or positive trust-source composition is added.
The API continues to inject `DenyLinuxExecutableAuthorityTrustSource`.

## Consequences

- Authenticated trust can retain its anti-rollback checkpoint across restarts once a reviewed
  composition supplies a signer and roots.
- Database corruption or an invalid highest snapshot denies; the reader never falls back to an older
  version.
- Checkpoint history is independently inspectable without persisting private keys, credentials,
  prompts, transcripts, or raw runtime traffic.
- Codex, Hermes, and Pi remain `NOT_CONFIGURED`; this decision creates no runtime connection,
  process launch, provider access, deployment, or spend.

## Next boundary

Root provisioning and snapshot publication require an authenticated operator-controlled procedure,
separate authorization and audit review, and explicit approval before positive production
composition. Until then, further safe runtime work may exercise process/stream ownership only in
test-gated boundaries and must not claim a real configured runtime.
