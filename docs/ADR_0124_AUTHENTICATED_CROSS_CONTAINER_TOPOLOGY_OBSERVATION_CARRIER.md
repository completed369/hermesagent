# ADR-0124: Authenticated cross-container topology observation carrier

Date: 2026-09-06

## Context

ADR-0122/0123 can perform one authorized, kernel-authenticated observation inside either role, but
ADR-0120 cannot safely consume the worker result from an API-side coordinator through an arbitrary
queue, database row, or caller-provided object. A cross-container result must remain bound to the
same workspace, supervisor, provisioning plan, short-lived authority, and authenticated service
principals as the local exchange.

## Decision

Add an exported but uncomposed worker-only carrier protocol. One authorization binding commits to
the carrier identity, distinct API coordinator and worker principals, workspace, supervisor,
provisioning attempt, plan hash, and a maximum five-second validity window. The coordinator and
worker boundaries each consume one attempt and capture their injected methods before any await.

Every delivery carries independent mutually authenticated channel evidence binding the exact peer,
carrier, authorization hash, canonical message hash, and delivery time. A separate deny-by-default
inbound authenticator must derive the worker-side delivery from its concrete channel before the
handler validates the complete `WORKER_CLIENT` observation request or reaches its local observation
port. The coordinator independently validates the worker delivery, response correlation, complete
observation, and freshness. Cancellation and timeouts abort the attempt; the coordinator closes its
carrier even on denial. Observation freshness may not outlive carrier authority.

## Security and runtime-truth boundary

- The default carrier and observer deny. This protocol does not make caller metadata authoritative;
  a future concrete carrier must derive delivery evidence from a separately reviewed mutually
  authenticated channel.
- API/LISTENER observation remains role-local. Only the worker observation crosses this boundary.
- The carrier transmits no credential, secret, prompt, transcript, file content, or runtime command.
- No network implementation, queue, database table, Temporal workflow, certificate, key, shared
  mount, listener activation, service loop, route, provider, deployment, publication, spend, DNS
  change, or Level-4 action is added.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

The distributed orchestration seam now has an exact fail-closed protocol instead of an arbitrary
transport object. A concrete mutually authenticated carrier implementation, role-local composition,
and the real shared runtime mount remain required before ADR-0121 can be composed or connectivity
can be claimed.
