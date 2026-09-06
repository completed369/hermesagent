# ADR-0109: Durable native-module authorization trust composition

Date: 2026-09-06

## Context

The repository had a public-root registry, signed snapshot storage, immutable Level-3 issuance
evidence, a snapshot authenticator, and a durable anti-rollback checkpoint store. Those boundaries
were not joined into a workspace-scoped production-shaped authorization source. The generic reader
also intentionally admitted older authenticated publications that do not carry issuance evidence,
which is unsuitable for a future module-loading composition.

## Decision

Add an uncomposed, one-attempt PostgreSQL trust composition that:

1. fixes one safe workspace and supervisor identity at construction;
2. validates the exact Linux-x64 module-load request before trust access;
3. reads at most eight current public-only roots from that exact scope;
4. reads only the latest signed snapshot joined to immutable issuance evidence for that workspace;
5. independently authenticates the snapshot and advances the existing durable, hash-linked
   anti-rollback checkpoint before exposing its exact request-bound grant; and
6. opens a serializable transaction, takes the snapshot-publication lock followed by the public-root
   lock, then re-reads and requires the same latest audited snapshot and complete active root set.

The ordered locks match issuance publication's existing order. Separate post-lock reads avoid the
stale MVCC snapshot that a single statement could retain while waiting, and prevent a rotation,
revocation, or newer audited snapshot from linearizing inside the final currentness decision. All
dependency and validation failures become one non-sensitive denial.

## Security and runtime-truth boundary

- No private key, signer, socket, native binary, module host, path discovery, provider, or secret is
  introduced.
- The composition remains absent from the Nest module, routes, worker, and deployment configuration.
- It implements only the existing authorization-source port. It does not call the native loader and
  cannot promote runtime or connection state.
- `runtimeConnection` remains `NOT_CONFIGURED`; Codex, Hermes, and Pi remain `NOT_CONFIGURED`.
- No deployment, publication, spend, DNS change, commercial commitment, or Level-4 action occurs.

## Consequences

The durable publication-to-authorization-source chain now has an explicit fail-closed owner and a
single database-linearized currentness point. Actual root/key provisioning, custody and signer
service composition, deliberate loader/service ownership, native module packaging, and a complete
authenticated runtime round trip remain required before connectivity can be claimed.
