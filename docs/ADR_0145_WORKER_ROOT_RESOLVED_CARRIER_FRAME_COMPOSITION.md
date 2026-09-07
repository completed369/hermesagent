# ADR-0145: Worker root-resolved carrier frame composition

Date: 2026-09-07

## Context

ADR-0144 joins the worker's concrete mutually authenticated coordinator-root source to the
root-resolved observation endpoint. ADR-0128 separately provides a bounded, canonical, one-use
worker byte-frame endpoint. Leaving those reviewed components unjoined permits a future caller to
omit canonical framing or substitute a message handler before carrier authentication.

## Decision

Add an explicit unwired worker-local factory that builds the ADR-0144 root-resolved worker from its
exact concrete root source, injected observer and delivery signer, live carrier binding, and clock,
then wraps that exact object in the ADR-0128 frame endpoint with an explicit bounded timeout.

Construction performs no frame handling, root lookup, IPC exchange or close, observation, signing,
native call, or byte-channel activity. The resulting endpoint remains one-use and applies bounded
canonical UTF-8 JSON decoding before the root-resolved worker authenticates or observes a request.

## Security and runtime-truth boundary

- The frame handler cannot be substituted independently of the exact root-resolved worker.
- Existing validation still rejects substituted root sources, deny-only observer or signer ports,
  invalid carrier bindings or clocks, and frame timeouts outside 100 ms to five seconds.
- No byte channel, listener, loader, module/socket path, OS principal mapping, observer
  implementation, signing key or transport, route, mount, or application lifecycle is selected.
- The factory remains absent from `worker.ts` and production supplies no caller.
- No deployment, publication, provider activation, spend, DNS change, commercial commitment, or
  Level-4 action occurs.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

The worker now has one explicit reviewed composition from its authenticated root source through the
root-resolved role endpoint to bounded canonical carrier framing. Remaining work must provide
separately reviewed concrete observer and keyless signer compositions, an authenticated byte
channel/listener lifecycle with approved deployment-specific identities and paths, and verified
round-trip evidence before any runtime can be reported connected.
