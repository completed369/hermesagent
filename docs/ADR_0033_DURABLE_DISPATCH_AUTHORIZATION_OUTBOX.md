# ADR-0033: Durable DISPATCH authorization metadata without transport

## Status

Accepted as a bounded runtime-foundation slice.

## Decision

The Agent Control Plane may prepare one short-lived, authenticated
parent-to-runtime `DISPATCH` envelope for an existing durable dispatch that is
still `PREPARED`. Preparation requires an exact Level 3 `CONTROL_PLANE`
capability and a serializable transaction that locks and re-reads the bound
session, connection, dispatch, run, task, and broker reservation. The database
clock, fresh healthy `PARTIAL` heartbeat, session expiry, Level 0-3 authority,
broker evidence, capability policy, assignment binding, and run policy are
revalidated before persistence.

A reservation's pre-claim expiry governs only the `RESERVED` to `CLAIMED`
transition. Once the database has atomically bound a `CLAIMED` reservation to
the exact dispatch, that historical timestamp is not treated as a later
authorization deadline. Capsule lifetime remains capped by the current session
expiry and sixty seconds.

Outbound sequencing is distinct from the runtime-to-parent receipt sequence.
It is serialized under the bridge-session lock and constrained by a unique
session/sequence key plus an insert trigger. The HMAC uses only the derived
`parent-to-runtime` key obtained from a `SIGN_FRAME` secret lease. Both
directional keys are zeroed after success or failure.

The durable record contains only exact identifiers, safe evidence/policy
digests, envelope/authenticator digests, sequence, and bounded timestamps. It
does not contain the raw JSONL line, payload JSON, MAC, principal reference,
task text, inputs, outputs, criteria, prompts, transcripts, reasoning, or secret
material. The signed envelope is an ephemeral service return value. Its
existence is not evidence of transmission or runtime receipt.

## Fail-closed boundaries

- Database composite foreign keys bind the metadata to the exact session,
  connection/runtime, and full dispatch evidence tuple.
- Insert triggers independently require current `PREPARED` run/dispatch and
  `READY` task state, authority below Level 4, a fresh healthy `PARTIAL`
  connection, an unexpired `PARTIAL` session, current policy hash, database
  time, and the next outbound sequence.
- Metadata is immutable. Deletion is allowed only as part of workspace erasure.
- Idempotent replay must bind the same capsule, dispatch, and idempotency key and
  is denied after capsule expiry. The service re-signs and constant-time checks
  every stored digest before returning a replay.
- The database trigger validates correlation, state, policy, sequencing, and
  time. It cannot verify HMAC cryptography. The row is service-produced
  correlation metadata, not a transferable launch or delivery capability;
  every consumer must re-sign or cryptographically reverify it through the
  trusted service boundary.
- Production secret resolution remains deny-only. No positive credential source
  is added by this decision.

## Explicit non-goals

This decision adds no controller, queue consumer, socket, pipe, process,
provider adapter, delivery worker, retry worker, or deployment path. There is
no `SENT`, delivered, acknowledged, connected, or completed state. Dispatch and
run state remain `PREPARED`; runtime truth remains at most `PARTIAL`; Codex,
Hermes, and Pi remain `NOT_CONFIGURED`.
