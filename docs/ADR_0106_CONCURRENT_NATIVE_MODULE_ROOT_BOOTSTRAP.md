# ADR-0106: Concurrent native-module root bootstrap

Date: 2026-09-06

## Context

The post-merge no-deploy staging gate for ADR-0105 exposed a race in ADR-0102's public-root
registry. Two identical first provisions could concurrently insert the supervisor/workspace scope.
The losing statement handled conflicts against the supervisor primary key, but PostgreSQL could
report the equivalent composite unique index first. That leaked SQLSTATE `23505` instead of
converging to one `APPENDED` and one `REPLAYED` outcome.

## Decision

Bootstrap the scope with untargeted `ON CONFLICT DO NOTHING`, then construct `bound_scope` from
either that statement's `RETURNING` row or a pre-existing exact supervisor/workspace row. Root and
evidence insertion still select only from `bound_scope`.

This has three fail-closed outcomes:

1. one concurrent identical bootstrap inserts the scope, root, and evidence atomically;
2. a loser that cannot see the winning scope in its statement snapshot inserts nothing, then
   authenticates the committed root and evidence in the existing separate replay read; and
3. a cross-workspace conflict yields no exact bound scope and fails replay authentication.

The integration contract now races eight identical bootstrap attempts and requires exactly one
`APPENDED` plus seven authenticated `REPLAYED` outcomes.

## Security and runtime-truth boundary

- Scope ownership remains immutable and globally unique by supervisor instance.
- No conflict is accepted as replay without exact root and Level-3 evidence reauthentication in a
  later statement.
- No migration, key, root provisioning action, runtime composition, deployment, spend, DNS,
  provider activation, legal commitment, or Level-4 action is introduced.
- Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

Identical concurrent first provisions now converge without weakening cross-tenant isolation. A
different valid root racing the first scope bootstrap may still fail closed and be retried by a new
caller operation after the scope is visible; it is never silently admitted or treated as replay.
