# ADR-0034: Durable exclusive egress handoff claims without a sender

## Status

Accepted as a bounded runtime-foundation slice.

## Decision

An internal Level 3 `CONTROL_PLANE` service may claim one short, exclusive
opportunity to hand an existing prepared `DISPATCH` authorization to a future,
separately reviewed egress boundary. The service uses the established global
session, connection, dispatch, run, task, runtime, reservation, and outbox lock
order. It revalidates the database clock, current `PARTIAL` session and healthy
`PARTIAL` heartbeat, `PREPARED` dispatch/run, `READY` task, Level 0-3 authority,
claimed reservation, broker evidence, capability policy, and every outbox
binding after asynchronous verification and the `SIGN_FRAME` lease.

Each append-only attempt copies the complete durable outbox binding, the exact
authenticated capability principal and actor kind as its owner, a bounded
idempotency key, serialized generation, database claim time, and at most
fifteen-second expiry capped by the session and outbox. Callers cannot supply
or substitute owner authority. A still-live attempt excludes competitors. The
exact same authenticated owner/idempotency tuple may replay only while live,
after re-signing the frame and constant-time comparison of every durable
digest. Both directional keys are zeroed. Service-created attempt metadata and
its zero-payload audit event commit atomically.

Natural expiry never rewrites an attempt. The same authenticated principal and
actor kind may end a live claim early through a separate immutable release row
and zero-payload audit event. A later claim is another append-only generation;
neither release nor reclaim overwrites history.

The returned frame exists only in memory for the caller. The database stores no
raw line, payload, MAC, task text, runtime/session principal reference, secret
reference, artifact URI, prompt, transcript, reasoning, or credential. It does
store the exact authenticated control-plane owner principal ID and actor kind
needed to prevent cross-principal claim or release replay.

## Database boundary

The insert trigger locks and rereads the same parents in the same order, exact
compares every copied outbox column, requires a fresh database-authored claim
window, serializes generations, and rejects overlapping live attempts. Rows are
immutable except during workspace erasure.

The trigger is deliberately metadata-only and non-cryptographic. It proves
database correlation, state, time, and exclusivity; it cannot prove an HMAC was
computed or authenticate a caller. Only service-created attempts and releases
carry the atomic audit guarantee. An alternate database writer can create a
trigger-valid but unauthenticated correlation row without an audit event. Such
a row is not a delivery or launch capability. Any future consumer must use the
trusted service to re-sign and reverify every binding, or independently
cryptographically verify the ephemeral frame; trigger validity alone is never
authority.

## Explicit non-goals

This adds no sender, worker, queue, controller, socket, pipe, process, provider,
credential backend, deployment, delivery retry, or acknowledgement. It writes
no `SENT`, delivered, connected, or completed state. Runtime truth remains at
most `PARTIAL`; Codex, Hermes, and Pi remain `NOT_CONFIGURED`; production secret
resolution remains deny-only.
