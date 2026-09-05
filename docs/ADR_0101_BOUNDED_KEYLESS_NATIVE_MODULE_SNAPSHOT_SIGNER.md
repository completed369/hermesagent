# ADR-0101: Bounded keyless native-module snapshot signer

Date: 2026-09-06

## Context

ADR-0098 deliberately keeps private-key custody outside the native-module authorization snapshot
controller. ADR-0100 supplies the exact Level-3 issuance decision, but the remaining signer port had
only a deny implementation and test-local in-process keys. Importing a production private key into
the API or worker would collapse the approval, control-plane, and signing-custody boundaries.

## Decision

Add an exported but uncomposed one-use signer client that:

1. accepts only an exact inert Ed25519 snapshot-signing request for one constructor-bound signer;
2. independently recomputes the canonical snapshot payload hash before any transport call;
3. sends a domain-separated canonical request of at most 32 KiB through an injected keyless
   transport, with an exact request hash and `NOT_CONFIGURED` runtime truth;
4. limits the exchange and channel close to explicit 100–5,000 ms deadlines, aborts the exchange,
   and closes the channel before returning or denying; and
5. accepts only a canonical response of at most 1 KiB bound to the signer, payload hash, request
   hash, protocol version, and Ed25519 signature encoding.

The returned signature remains untrusted until the independent ADR-0097/ADR-0099 publisher verifies
it against a reviewed public root and atomically stores its approval evidence.

## Security and runtime-truth boundary

- The client imports no private key and has no key-generation, signing, filesystem, socket, process,
  environment, provider, or secret-resolution capability.
- The injected transport is deny-by-default. This change provides no Unix-socket, KMS, HSM, cloud,
  or other live signing transport and provisions no public trust root.
- Every attempted use consumes the signer and closes its transport, including malformed requests,
  oversized requests, transport failures, timeouts, and malformed responses.
- Accessors, symbols, custom prototypes, cycles, excessive depth/node counts, response drift, and
  non-canonical JSON fail closed.
- No composition root constructs the client. No runtime is loaded or started, no external service is
  contacted, and no deployment, publication, spend, DNS, legal, or Level-4 action occurs.
- Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

The approved snapshot controller can now delegate signing without placing key material in its
process, while the existing publisher remains the cryptographic trust decision. A separately
reviewed transport, signer service or managed-key adapter, immutable public-root provisioning,
service ownership, and production composition remain required before native runtime loading.
