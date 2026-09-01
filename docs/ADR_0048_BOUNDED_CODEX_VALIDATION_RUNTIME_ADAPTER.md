# ADR-0048: Bounded Codex validation runtime adapter

## Status

Accepted as an uncomposed, deny-by-default runtime-side evidence boundary.

## Context

ADR-0047 proves an exact dispatch-bound terminal response over an injected Codex app-server
transport. ADR-0046 admits authenticated sequence-2 acceptance and sequence-3 result frames at the
durable parent boundary. No reviewed component connected those two pieces: the runner could not
authenticate an incoming parent dispatch, acquire a scoped runtime signing lease, or emit the two
canonical runtime-to-parent frames.

That missing link must not make the protocol runner a launcher, expose raw bridge secret material,
or let synthetic evidence promote runtime truth. It must also keep one dispatch within its exact
authentication, tenant, resource, duration, cancellation, and replay boundaries.

## Decision

Add a bounded runtime adapter over three injected ports: the existing validation protocol runner,
the existing scoped bridge secret-lease resolver, and the existing bounded local egress transport.
For one exact dispatch it:

1. revalidates the immutable zero-cost dispatch candidate and exact authenticated bridge identity,
   including the bridge-identity and secret-binding hashes;
2. authenticates the canonical sequence-1 `DISPATCH` with a short-lived `VERIFY_FRAME` lease and
   the parent-to-runtime directional key;
3. runs the already reviewed read-only/no-network validation protocol within the lesser of the
   dispatch duration, dispatch expiry, and bridge expiry;
4. strictly revalidates the terminal evidence before any response is signed;
5. obtains a separate `SIGN_FRAME` lease, signs sequence-2 `DISPATCH_ACCEPTED` and sequence-3
   `RESULT` with the runtime-to-parent directional key, and zeroes both derived key copies; and
6. writes both canonical JSONL frames through bounded, cancellation-aware, mutation-detecting
   local writes before returning the existing immutable round-trip candidate.

The adapter consumes each session/dispatch pair at most once. A failed, timed-out, or partially
written attempt cannot be replayed through the same adapter instance. It caps live replay tracking
at 1,024 dispatches and bounds input frames to eight levels and 1,024 values before canonicalizing
them. Response identifiers use a bounded hash of the dispatch reference, so a valid maximum-length
dispatch cannot expand a bridge message beyond protocol limits.

## Runtime truth and authority

The production defaults deny both secret resolution and transport writes. The adapter has no
process, executable, stream-construction, provider, credential, database, task-assignment, usage,
artifact, audit, or connection-transition authority. A successful injected test proves only the
composition contract; it is not evidence that a real Codex process ran. Returned evidence retains
`providerAccess: NOT_CONFIGURED`, `runtimeConnection: NOT_CONFIGURED`, and
`connectionTransition: NOT_APPLIED`. Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Next safe slice

Bind this runtime adapter to an exact supervised process handoff and its already-open app-server and
bridge streams, without changing the production deny launcher. Then exercise a separately
authorized real-process round trip and pass the emitted frames through the existing durable
admission boundary. Only independently verified exact-head evidence may support a later runtime
connection transition.
