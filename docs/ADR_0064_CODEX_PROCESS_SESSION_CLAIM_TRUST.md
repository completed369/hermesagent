# ADR-0064: Codex process-session claim trust closure

Date: 2026-09-01

## Context

ADR-0060 made process-session claims append-only and foreign-key bound to an exact egress handoff.
The foreign key covered dispatch identity, but it did not cover owner identity, the handoff expiry, or
the relative claim time. The service's idempotent replay path also rechecked only a subset of the
persisted supervisor binding. A privileged direct database writer could therefore insert a
constraint-valid but drifted claim and cause a later trusted replay to return poisoned metadata.

## Decision

Add a database `BEFORE INSERT` trust trigger that requires every process-session claim to reproduce
the handoff owner/principal, actor kind, `CLAIMED` state, and exact expiry. The claim time must be no
earlier than the handoff claim, no later than the database clock, and strictly before that exact
expiry. Migration aborts if any pre-existing row fails the same audit.

The Level-3 service replay path independently rechecks every persisted tenant, handoff, dispatch,
owner, supervisor, platform, admission, test-only, state, runtime-truth, time-window, and idempotency
field before returning an existing claim. Any mismatch is a conflict and no owner or stream can be
reached through the authority adapter.

## Security and truth boundary

- The trigger and replay checks grant no process, launcher, owner, secret, transport, or provider
  authority.
- Direct writers cannot substitute a longer lease or another owner while retaining a valid foreign
  key.
- Claims remain immutable and `NOT_CONFIGURED`; this adds no task assignment, usage/cost recognition,
  deployment, publication, or connection transition.
- Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

The durable claim is now fail-closed at both the database insertion boundary and trusted replay
boundary. Positive process ownership, exclusive recovery action, authenticated real-runtime proof,
and runtime truth promotion remain separate work.
