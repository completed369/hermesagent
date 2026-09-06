# ADR-0129: Keyless topology carrier delivery signing

Date: 2026-09-07

## Context

ADR-0125 authenticates each topology carrier delivery through an injected signer, and ADR-0127
places that signer in each role-local assembly. The signer port intentionally carries no private
key, but a future transport adapter could still accept an over-broad payload, reuse an endpoint,
ignore cancellation, or release a response before its channel is closed.

## Decision

Add a transport-neutral, one-use keyless signer for topology carrier deliveries. Construction binds
one live carrier binding, one `API_COORDINATOR` or `WORKER_CLIENT` role, the corresponding principal,
one signer key reference, and a 100 ms to five second deadline. The signer accepts only the exact
canonical ADR-0125 payload for that role: carrier, binding hash, principal, delivery time, message
hash, direction, and `NOT_CONFIGURED` runtime truth must all match.

The injected byte transport receives a canonical signing request containing that bounded payload,
its hash, the complete public scope, and a domain-specific request hash. A canonical response must
reproduce every scope and hash and contain one syntactically valid Ed25519 signature. Requests are
bounded to 72 KiB, responses to 2 KiB, and both use inert acyclic JSON with bounded depth and node
count. Cancellation reaches the active exchange, exchange and close are independently bounded, and
transport close must complete before a proof can escape. Every attempted sign closes once,
including malformed input, cancellation, timeout, synchronous failure, and malformed response.

## Security and runtime-truth boundary

- The signer never imports, resolves, generates, or retains private key material. Key custody and
  the signing endpoint remain outside this boundary.
- The byte transport is injected and denies by default. No socket, network protocol, TLS identity,
  route, provider, KMS, secret store, process, filesystem path, or application composition is
  selected.
- The opposite role still verifies the returned signature against its independently resolved
  ADR-0126 public root. A successful local signing exchange is not runtime connectivity evidence.
- The implementation remains absent from API and worker composition. No root, key, channel, mount,
  activation, deployment, publication, spend, DNS change, or Level-4 action is introduced.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

Both carrier roles can now consume a narrowly scoped keyless signing service without giving a
future adapter control over payload selection or lifecycle. Remaining work includes audited
role-local root adapters, independently authenticated signing and carrier transports, routing,
the missing shared runtime mount, and a verified end-to-end runtime round trip.
