# ADR-0062: Control-plane Codex process-session authority adapter

Date: 2026-09-01

## Context

ADR-0061 added a fail-closed runtime-side authority port, but no control-plane adapter bound that
port to ADR-0060's durable claim and completion operations. Leaving the two boundaries disconnected
prevented a future injected owner from using the durable ordering without bespoke glue.

## Decision

The Agent Control Plane may create one immutable authority adapter from an already-issued Level-3
control-plane capability, tenant/principal context, exact handoff/claim identity, and separate claim
and completion idempotency keys. The adapter delegates `claim` and `complete` to ADR-0060's existing
serializable, append-only operations.

Creation rechecks control-plane authority and validates all public identities. It snapshots the
tenant/principal and identity values. Completion rejects a supervisor binding that differs from the
cleanup evidence before reaching durable storage. Durable methods still revalidate the complete
dispatch, binding, owner, expiry, cleanup hash, and replay identity with the database clock.

## Security and truth boundary

- The adapter is not exposed by an HTTP route and does not mint capabilities.
- It grants no process owner, launcher, stream, secret lease, transport, provider credential, task
  assignment, or runtime-status authority.
- The process owner, secret resolver, and transport remain deny-only in production; no service yet
  composes all boundaries into a runnable process path.
- No provider traffic, recognized usage/cost, spend, deployment, publication, or connection
  transition is added.
- Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

The durable ledger and runtime coordinator now share a typed, tenant-bound adapter suitable for a
later reviewed composition. A positive OS-specific owner, crash recovery, and real authenticated
runtime round trip remain separate work.
