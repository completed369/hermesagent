# ADR-0095: Durable native-module authorization trust state

Date: 2026-09-05

## Context

ADR-0094 authenticates short-lived retained-native module-authorization snapshots and requires an
instance-scoped compare-and-swap checkpoint before exposing a grant. Its injected ports deliberately
had no durable implementation, so rollback resistance could not survive a process restart.

## Decision

Add uncomposed PostgreSQL snapshot-reader and checkpoint-store adapters plus migration-enforced
state:

1. immutable, supervisor-instance-scoped signed snapshots with exact top-level and authorization
   JSON shape, a five-minute maximum window, canonical client-before-listener ordering, and at most
   one authorization per module kind;
2. one checkpoint row per supervisor instance, foreign-key-bound to the exact immutable snapshot;
3. database-side canonical JSON hashing that binds each nullable client/listener authorization ID,
   version, and hash triple to the matching signed snapshot member;
4. atomic bootstrap or exact all-field compare-and-swap advancement, with adjacent versions,
   immutable instance/creation identity, and same-ID authorization-version rollback denial; and
5. append-only digest/reference audit evidence for every successful bootstrap or transition.

A signed empty authorization list persists both grant triples as null. It therefore advances durable
revocation state without storing executable authority.

## Security and runtime-truth boundary

- The adapters accept only an injected parameterized SQL client and an explicit supervisor instance.
- No route, worker, scheduler, service module, or composition root constructs them.
- No root record, signing key, credential, module bytes, raw request, transcript, prompt, or secret is
  added to checkpoint or audit rows.
- Snapshot publication, root/key provisioning, path provisioning, native loading, service lifecycle,
  provider access, deployment, publication, spend, and Level-4 actions remain absent.
- Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

ADR-0094 can retain authenticated anti-rollback and explicit revocation state across restarts once a
separately reviewed publisher and root provisioner exist. The next safe dependency remains an
identity-preserving, owner-only native module/socket path provisioner. Durable state alone neither
loads code nor proves a runtime connection.
