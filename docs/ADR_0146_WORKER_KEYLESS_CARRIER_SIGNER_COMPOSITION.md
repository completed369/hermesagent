# ADR-0146: Worker keyless carrier signer composition

Date: 2026-09-07

## Context

ADR-0145 frames the exact root-resolved worker endpoint but still accepts an arbitrary delivery
signer port. ADR-0129 defines a bounded keyless signer whose role, principal, carrier binding, key
reference, request bytes, deadline, cancellation, and close-before-release behavior are fixed, but
no worker composition constructs it for the exact `WORKER_CLIENT` role and carrier binding.

## Decision

Add an explicit unwired worker-local factory that first rejects substituted root sources and
deny-only observers, constructs the bounded keyless delivery signer with the role fixed to
`WORKER_CLIENT` and the same live carrier binding and clock, then supplies that exact signer to the
ADR-0145 framed root-resolved endpoint. The caller injects only a signer key reference and the
bounded signer's transport port plus explicit signing and framing deadlines.

Construction performs no signing exchange or close, root lookup, frame handling, observation, IPC,
or native call. The keyless signer still sends only the canonical binding-scoped signing request and
must close its injected transport before a proof can escape.

## Security and runtime-truth boundary

- The caller cannot substitute the worker signing role or bind the signer to a different carrier.
- Substituted root sources and deny-only observers fail before the signing transport is inspected.
- The bounded signer rejects deny-only transports, invalid key references, expired or malformed
  bindings, invalid clocks, and deadlines outside 100 ms to five seconds.
- No signing transport implementation, private key, custody mechanism, observer implementation,
  byte channel, listener, loader, path, principal mapping, mount, route, or lifecycle is selected.
- The factory remains absent from `worker.ts` and production supplies no caller.
- No deployment, publication, provider activation, spend, DNS change, commercial commitment, or
  Level-4 action occurs.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

The reviewed worker path now fixes delivery signing to the bounded keyless implementation and exact
worker role before canonical framing. Remaining work must provide separately reviewed signer
transport/custody and retained-descriptor observer compositions, an authenticated byte-channel
listener with approved deployment-specific identity and path inputs, and verified round-trip
evidence before any runtime can be reported connected.
