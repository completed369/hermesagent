# ADR-0057: Authenticated durable Codex validation cancellation evidence

Status: Accepted as evidence-only infrastructure

## Context

ADR-0056 proved that the bounded Codex validation runner can send one correlated
`turn/interrupt`, require its exact response, and then require an interrupted terminal. The adapter
discarded that proof by returning a local `CANCELLED` error with no authenticated bridge output.
Consequently the durable control plane could not distinguish an acknowledged cancellation from a
transport failure, process exit, or caller assertion.

ADR-0015 requires cancellation evidence to be correlated and durable before runtime truth can ever
be promoted. This slice must retain that evidence without treating a test-only process composition
as a live runtime connection.

## Decision

After the exact interrupt response and interrupted terminal have both been admitted, the bounded
runtime adapter may emit exactly one runtime-to-parent `CANCELLED` envelope at sequence 2. The
envelope binds the zero-spend validation dispatch, task, run, challenge, interrupt request and
response hash, terminal thread and turn, and terminal message hash. The original caller abort signal
does not cancel this final evidence write because it is already aborted; the existing dispatch,
session, controller, and transport deadlines continue to bound the write.

The API admits the envelope only through the scoped runtime-to-parent verification lease and only
against the exact immutable registration, capability, heartbeat, validation-dispatch, and claimed
handoff chain. It stores hashes and safe references rather than the MAC, raw frame, prompt,
transcript, secret, or provider data. Candidate, handoff, message, and idempotency identities are
unique and replay checked.

Completion and cancellation are mutually exclusive. Both admission operations lock the same parent
handoff. Database insert triggers also lock that parent and reject a peer terminal outcome, so a
direct or concurrent insert cannot persist both outcomes.

Cancellation evidence is deliberately non-authorizing: it does not assign the prepared run, mutate
the task, update heartbeat fields, grant provider access, or transition runtime or connection truth.
The durable result remains `INTERRUPTED`, provider access remains `NOT_CONFIGURED`, runtime and
connection remain `NOT_CONFIGURED`, and connection transition remains `NOT_APPLIED`.

## Consequences and limits

VentureOS can now authenticate, normalize, replay-check, audit, and immutably retain the cancellation
proof produced by the deterministic Codex validation composition. Missing or mismatched interrupt
acknowledgements, malformed terminals, stale authority, wrong secrets, cross-tenant evidence, and
completion/cancellation conflicts fail closed.

This is not evidence that a real Codex provider operation stopped. Production process and stream
ownership, executable authority, secrets, and launch composition remain deny-only. No provider is
contacted, no deployment occurs, and no paid capability is activated. Codex, Hermes, and Pi remain
`NOT_CONFIGURED`.

## Next boundary

The next reviewed runtime slice must supply a production-owned, authenticated process/stream
composition and exercise the same registration through terminal evidence chain against a real Codex
process. Runtime truth may be reconsidered only after exact-head evidence proves the complete
authenticated round trip and all approval, budget, secret, audit, cleanup, and usage invariants.
