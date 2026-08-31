# ADR-0046: Authenticated Codex validation round-trip evidence

## Status

Accepted as an immutable evidence-only admission boundary.

## Context

ADR-0043 prepares one signed, zero-spend validation dispatch and ADR-0044 grants a one-shot local
write claim. Neither boundary admits a runtime response. The ordinary Agent Bridge result path
requires an already-partial connection and assigned run, so reusing it for bootstrap validation
would manufacture the very runtime truth the validation is intended to prove.

## Decision

Add a separate pure normalizer and durable admission operation for exactly two runtime-to-parent
frames: sequence 2 `DISPATCH_ACCEPTED`, followed by sequence 3 `RESULT`. Both frames must bind the
same authenticated bridge identity, validation challenge, dispatch, task, and run. The result must
bind the terminal evidence hash and exact `VALIDATION_COMPLETED` outcome. The service re-verifies
both MACs through a generation-1 scoped `VERIFY_FRAME` secret lease and rechecks the immutable
dispatch, claimed handoff, zero-cost ready/unassigned validation run, and unchanged Codex runtime
and connection state.

Persist only safe references, timestamps, normalized states, unsigned-envelope and payload
digests, and one-way MAC digests. Bind the row by composite foreign key to the exact handoff and
make it immutable except during workspace cascade deletion. Exact authenticated replay is
idempotent; candidate, handoff, message, or idempotency drift is denied or conflicts.
Each status/result message ID is also claimed in one session-global immutable registry so it cannot
be replayed later in either role or raced across handoffs.

The operation is evidence-only. It does not assign the task or run, update heartbeat or capability
fields, transition the runtime or connection, start a process, contact a provider, retain content,
or spend money. The retained row says `providerAccess: NOT_CONFIGURED`,
`runtimeConnection: NOT_CONFIGURED`, and `connectionTransition: NOT_APPLIED`.

## Consequences

VentureOS can now durably distinguish a cryptographically valid correlated validation response
from local byte acceptance without weakening bootstrap truth. Synthetic tests are not live-runtime
evidence, and production secret resolution, launch authority, process creation, and stream
composition remain deny-only or absent. A future separately reviewed composition must obtain the
same evidence from a real authenticated Codex app-server process before any connected-state
transition. Codex, Hermes, and Pi remain `NOT_CONFIGURED`.
