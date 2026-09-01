# ADR-0054: Test-only authenticated native dispatch round trip

Status: Proposed (source authored; Linux execution pending authoritative Ubuntu CI)

## Context

ADR-0032 proved that a retained Linux executable can receive scoped authentication material through
an anonymous descriptor and emit an authenticated lifecycle transcript. That fixture did not own a
parent-to-runtime stream or require the child to authenticate a dispatch before returning a result.
The production launcher, trust roots, secrets, and runtime status remain deliberately unconfigured.

## Decision

Extend only the ignored Linux x86-64 native fixture boundary with an
`authenticated-dispatch` case:

- the composition-owned one-use native handoff is consumed before secret resolution or native work;
- the parent derives the directional bridge keys from one scoped synthetic test lease and creates
  one exact, 30-second, zero-spend `DISPATCH` envelope;
- the native addon copies at most 2048 dispatch bytes and the secret into owned memory, clears both
  copies after the synchronous native call, and exposes no public launch function;
- the supervisor writes the one canonical dispatch frame to a close-on-exec anonymous pipe, closes
  the write end, and gives only its read end to the retained child as standard input;
- the child derives the distinct parent-to-runtime key, accepts exactly one newline-terminated
  canonical frame, verifies its exact binding, payload digest, and HMAC, and only then emits
  `DISPATCH_ACCEPTED` followed by `RESULT`;
- the parent bounds standard output, requires exactly
  `CAPABILITIES -> HEARTBEAT -> DISPATCH_ACCEPTED -> RESULT`, waits for pidfd-observed exit and
  process-group cleanup, and binds both input and transcript digests into native evidence; and
- TypeScript independently authenticates every runtime-to-parent frame after cleanup. A mutated
  parent dispatch is denied without completion evidence.

The input can be buffered before the child emits capabilities; this test proves descriptor
ownership and bidirectional authentication, not a production interactive scheduler or a general
stream multiplexer.

## Consequences and limits

This closes a test-evidence gap between authenticated dispatch construction and a real retained ELF
process. The fixture, addon, launcher, synthetic secret, and key material remain test-only,
unexported, excluded from package output and final images, and unavailable to the API composition.
There is no production process launcher, root activation, provider contact, deployment, spend,
durable runtime mutation, or status promotion. Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Next boundary

A production process/stream owner still requires reviewed crash recovery, long-lived cancellation,
backpressure and stderr policy, live trust/root provisioning, and an authenticated real Codex
app-server exercise. Root activation and real provider/runtime use remain separate approval
boundaries.
