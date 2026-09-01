# ADR-0063: Bounded Codex process-session recovery inventory

Date: 2026-09-01

## Context

ADR-0060 made process-session claims and cleanup completions durable, and ADR-0062 bound the runtime
authority port to those append-only operations. After a service restart, however, no trusted service
method could discover claims that lack a matching completion. A later recovery worker would otherwise
need bespoke or unbounded database access before it could determine whether owner cleanup is required.

## Decision

The Agent Control Plane exposes an internal, read-only recovery inventory for an already-issued Level-3
control-plane capability. The query is bound to the exact workspace, principal, and actor kind from that
capability; excludes every claim with a matching completion; orders by immutable claim identifier; and
uses a validated limit of 1–100 plus an optional validated cursor.

Each immutable result contains only the durable correlation and supervisor binding needed by a future
recovery composition. The database clock classifies each unfinished claim as `ACTIVE` or `EXPIRED` and
supplies the page observation time. Runtime truth remains `NOT_CONFIGURED`.

## Security and truth boundary

- The inventory has no HTTP route and grants no capability, owner, stream, secret lease, or transport.
- It does not open, signal, terminate, retry, complete, or mutate a process session.
- Active rows are discovery evidence, not authority to race an existing owner. Any future recovery action
  must separately revalidate durable state and prove OS-specific ownership and cleanup.
- The method stores no payload, transcript, credential, provider response, or recognized usage/cost.
- It performs no provider traffic, spend, deployment, publication, assignment, or connection transition.
- Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

A later reviewed recovery worker can discover bounded owner-scoped unfinished claims without broad SQL
access. A positive recovery owner, exclusive recovery lease, OS-process proof, authenticated real-runtime
round trip, and runtime truth promotion remain separate work.
