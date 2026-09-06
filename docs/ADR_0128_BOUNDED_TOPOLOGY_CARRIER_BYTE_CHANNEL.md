# ADR-0128: Bounded topology carrier byte channel

Date: 2026-09-07

## Context

ADR-0127 assembles both authenticated carrier roles but intentionally accepts an abstract carrier.
Passing arbitrary objects through that boundary would leave size, serialization, cancellation, and
one-request/one-response behavior to a future provider adapter, creating inconsistent enforcement
before the ADR-0125 signature checks.

## Decision

Add a transport-neutral client carrier and worker frame endpoint over injected byte-channel ports.
Both sides accept exactly one canonical UTF-8 JSON frame of at most 64 KiB. Values must be inert,
acyclic JSON with safe integers and bounded depth, node count, object fields, and array length.
Non-canonical ordering, duplicate fields, invalid UTF-8, exotic objects, accessors, symbols,
oversized frames, and malformed JSON deny before a message crosses the adjacent trust boundary.

The client converts one object request into one byte exchange, validates the complete response
frame, and closes its injected channel exactly once before returning. Exchange and close each have
a configurable 100 ms to five second deadline. Cancellation propagates to the active exchange, and
a non-cooperating exchange or close cannot release a response. The worker endpoint symmetrically
decodes one request, invokes one injected signed handler under the same bounded cancellation
contract, and encodes one response. Both roles are one-use and their defaults deny.

## Security and runtime-truth boundary

- The byte channel is injected and untrusted. This decision defines framing and lifecycle but does
  not choose HTTP, TLS, Temporal, a socket, a queue, a route, or a provider.
- The worker message handler is injected; ADR-0127 and ADR-0125 authentication remain responsible
  for role, principal, binding, signature, freshness, and observation validation.
- The module imports no network, TLS, filesystem, process, environment, database, provider, or
  orchestration implementation and remains absent from API and worker composition.
- No channel, trust root, key, shared mount, activation, deployment, publication, spend, DNS change,
  or Level-4 action is added.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

A future infrastructure adapter has one small byte exchange and close contract rather than control
over protocol parsing or lifecycle. VentureOS still has no configured cross-container channel; the
remaining work includes independently reviewed transport identity and routing, audited role-local
root adapters, keyless signer composition, and the missing shared runtime mount.
