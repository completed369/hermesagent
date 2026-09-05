# ADR-0097: Authenticated native-module authorization snapshot publication

Date: 2026-09-05

## Context

ADR-0095 stores immutable retained-native module-authorization snapshots, but deliberately supplied
no publication boundary. A raw writer could make an invalid signed-looking row the latest snapshot,
while unconstrained concurrent inserts could create a gap or fork and deny access to the last good
state.

## Decision

Add an exported but uncomposed publication boundary that:

1. reuses the exact ADR-0094 parser and Ed25519 verifier for explicit supervisor identity, trusted
   root purpose, fingerprint, version floor, validity, revocation, snapshot window, canonical grant
   ordering, and grant containment;
2. passes storage only an in-process authenticated snapshot proof and canonical payload hash;
3. defaults storage to denial and accepts only `APPENDED` or exact-latest `REPLAYED` outcomes;
4. makes the PostgreSQL adapter reject forged proof objects before issuing SQL and uses only
   parameterized statements; and
5. serializes inserts per supervisor instance in PostgreSQL, admitting only version-one bootstrap,
   an exact replay of the current head, or the exact hash-linked adjacent successor. Gaps,
   rollback, equivocation, and concurrent forks fail closed.

## Security and runtime-truth boundary

- The publisher cannot generate, import, store, or use a private signing key.
- Root records and the SQL client are explicitly injected; no route, worker, scheduler, service
  module, or composition root constructs the publisher.
- The migration independently preserves chain shape, while cryptographic admission remains an
  application boundary and is not falsely attributed to PostgreSQL.
- No module is packaged or loaded, no path is selected or provisioned, no socket or process is
  started, and no provider, deployment, external publication, spend, DNS, commercial, or Level-4
  action is performed.
- Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

The latest durable snapshot can no longer be displaced through the reviewed adapter by malformed or
unauthenticated input, and concurrent publishers cannot create two chain heads. Positive service
composition still requires reviewed root/key custody, an authorized signer/controller, service
ownership, native loading, authenticated runtime wiring, and a complete round trip.
