# ADR-0056: Test-only Codex validation cancellation round trip

Status: Accepted as deterministic test evidence

## Context

ADR-0015 requires a correlated cancellation exercise before a runtime can become `CONNECTED`.
The Codex app-server session could construct and validate `turn/interrupt`, but the bounded validation
runner did not send it. Aborting an ordinary stdio operation instead terminated the transport and
could not prove that the runtime acknowledged cancellation or reached an interrupted terminal state.

## Decision

Extend the bounded validation runner and deterministic process composition with one exact
cancellation path:

- cancellation is armed only after the read-only turn has been accepted and correlated;
- one abort requests exactly one `turn/interrupt` for the active thread and turn;
- the interrupt write may proceed while the bounded transport owns the outstanding progress read,
  avoiding a second concurrent read or an unbounded side channel;
- the runner accepts only the exact interrupt response identifier, then requires the same turn to
  reach terminal status `interrupted` before the shared deadline;
- a mismatched response identifier or a completed terminal after cancellation is denied;
- the runtime adapter reports the structurally valid interrupted terminal as `CANCELLED`; and
- cancellation emits no `DISPATCH_ACCEPTED`, `RESULT`, runtime-status transition, or durable claim.

A deterministic child-process mode validates the exact interrupt correlation and returns the
interrupted terminal event. It receives no inherited environment, credentials, network access, or
provider capability.

## Consequences and limits

The repository gains executable evidence for the cancellation portion of the Codex protocol and
keeps the authenticated dispatch burned after an attempted run. A silent or non-cooperative child
still fails at the existing bounded I/O/session deadline and the transport becomes terminal. This is
not evidence that a real Codex process was cancelled, that provider work stopped, or that durable
runtime cancellation was admitted. The fixture and positive composition remain test-only;
production launch, secrets, egress, and authorization remain deny-only. Codex, Hermes, and Pi remain
`NOT_CONFIGURED`.

## Next boundary

A real authenticated cancellation exercise requires the reviewed process/stream owner, live Codex
provisioning, and provider authority. Durable cancellation evidence must then bind the same runtime,
connection, session, dispatch, run, task, interrupt response, terminal event, and usage/audit chain
before any connection-state promotion.
