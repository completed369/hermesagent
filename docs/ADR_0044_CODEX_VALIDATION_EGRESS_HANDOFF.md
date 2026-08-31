# ADR-0044: Codex validation egress handoff

## Status

Accepted.

## Context

ADR-0043 prepares and signs an exact zero-spend Codex validation dispatch but deliberately does
not transmit it. The ordinary Runtime Broker egress path cannot be reused: it requires an assigned
run, a capacity reservation, and a runtime whose authenticated evidence has already advanced it to
`PARTIAL`. The bootstrap runtime is still `NOT_CONFIGURED`, so manufacturing those facts would
corrupt runtime truth.

## Decision

Add a separate Level-3 validation-egress claim and bounded local controller. The durable service
revalidates the exact immutable validation-dispatch evidence, active objective, ready and unassigned
task/run, zero cost, Level 0-3 authority, resource limits, empty runtime capability/heartbeat state,
`NOT_CONFIGURED` runtime and connection, bridge identity, scoped secret digest, and database-clock
expiry. It then reconstructs and re-signs the exact frame and stores one immutable claim for at most
15 seconds.

The claim is deliberately not idempotently replayable. Once it exists, the service never returns
the frame again. The controller accepts only the exact claimed frame, caps the local write at five
seconds, defaults to a deny transport, burns the claim within that controller instance as soon as a
write begins, and clears frame buffers afterward. A failed or timed-out write is ambiguous and
requires a new validation run; it is never retried.

The transport is an injected process-local byte-write port. This change provides no socket,
process launcher, provider client, production transport, worker, queue, deployment, or external
side effect.

## Consequences

A successful controller return proves only that the injected local transport accepted the exact
bytes before authority expired. It does not prove delivery, acknowledgement, task execution,
provider access, registration, capability exchange, heartbeat, status, result, artifact, usage, or
runtime connectivity. The controller cannot promote any durable truth. Production composition
remains fail-closed because its default transport denies every write, and Codex remains
`NOT_CONFIGURED`.

The next reviewed slice must supply a real bounded local Codex app-server transport and admit an
authenticated status/result round trip before any runtime-state transition can be considered.
