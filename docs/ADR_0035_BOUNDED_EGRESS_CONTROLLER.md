# ADR-0035: Bounded single-frame egress controller

## Status

Accepted as a deny-by-default runtime-foundation slice.

## Decision

The Agent Bridge package exposes a bounded controller for one already-signed
`DISPATCH` frame and one matching durable egress-handoff claim. Before reaching
an injected transport port, the controller exact-validates the claim schema,
safe references, both idempotency bindings, Level 0-3 authority,
database-authored claim window, complete dispatch payload binding, canonical
JSONL encoding, and the payload, unsigned envelope, signed envelope, and
authentication-tag digests copied from the durable outbox. Its claim shape
matches the durable attempt returned by `claimDispatchEgressHandoff`, including
the database `Date` values; canonical ISO timestamps are also accepted for a
future serialization boundary.

The controller passes one owned byte array to one transport call. It bounds the
call by both a five-second maximum and the shorter remaining claim lifetime,
supports cancellation, rejects concurrent use of the same attempt in one
controller, detects in-call byte mutation, and zeroes its working buffers after
completion or failure. Transport errors are replaced with a closed error code;
provider or operating-system detail is not propagated.

The transport contract is deliberately narrow: a successful call means only
that the entire canonical line was accepted by that local transport boundary.
It is not delivery, acknowledgement, runtime acceptance, or durable status
evidence. The returned result contains only local correlation and byte-count
metadata. It has no `SENT`, delivered, acknowledged, or connected state.

`DenyBridgeEgressTransport` is the only production-ready implementation in this
slice. No API composition root, socket, pipe, queue, process, provider, retry
worker, or runtime adapter is wired. A future adapter must be separately
reviewed, must copy the full line or reject atomically, and must honor the abort
signal before reporting completion.

## Security properties

- Workspace, runtime, connection, session, dispatch, task, run, agent, sequence,
  message, authority, broker, assignment, policy, capability, and digest fields
  must all match the claimed durable authorization.
- The attempt ID, claim idempotency key, and outbox idempotency key remain
  exact, safe, non-sensitive durable bindings; they are never transport input
  except for the attempt ID used as local correlation metadata.
- Only `DISPATCH` from a `PREPARED` Level 0-3 outbox is accepted.
- Claim authority expires after at most fifteen seconds and controller timeout
  can never exceed the remaining claim lifetime.
- Caller cancellation, timeout, transport rejection, mutation, malformed
  claims, and malformed or drifted frames fail closed with sanitized codes.
- The controller stores no durable state and cannot promote runtime truth.

## Explicit non-goals

This decision adds no real transport, runtime adapter, authenticated
registration, capability exchange, heartbeat source, task delivery proof,
result admission, provider activation, credential backend, process launch,
deployment, publication, payment, or customer action. Codex, Hermes, and Pi
remain `NOT_CONFIGURED`.
