# ADR-0125: Signed topology carrier delivery

Date: 2026-09-06

## Context

ADR-0124 defines exact delivery evidence but intentionally supplies no concrete mutually
authenticated carrier. Private-staging Temporal is an internal unauthenticated service, while a
production transport and its certificate or managed-service trust configuration remain platform
decisions. Treating transport-supplied peer metadata as authentication would let an arbitrary
carrier forge either side of the observation exchange.

## Decision

Add an uncomposed application-layer Ed25519 adapter around the ADR-0124 protocol. Each public trust
record is immutable, non-test, purpose-specific, principal-role-specific, exact-principal-specific,
and bound to one canonical five-second carrier authorization hash. Its validity must cover the
complete carrier authorization; revoked roots deny.

The coordinator adapter signs the complete canonical request delivery and message through an
injected keyless signer port before sending it over an otherwise untrusted carrier. The worker
authenticator verifies that signature before ADR-0124 parses the request or trusts delivery
metadata. A worker endpoint signs the complete response delivery and message; the coordinator
verifies it before ADR-0124 validates correlation or consumes the observation. Message hashes,
delivery times, principals, carrier identity, and binding hash are all inside the signed payload.
Both directions remain one-use and preserve the existing close, cancellation, expiry, replay, and
freshness controls. Canonical signed input is additionally constrained to inert, acyclic JSON with
bounded depth, nodes, fields, arrays, and a 64 KiB encoded ceiling before hashing or verification.

## Security and runtime-truth boundary

- Only public SPKI material is accepted here. Private key custody and signing are behind injected
  signer ports; default signers and carriers deny.
- The adapter imports no network, TLS, filesystem, process, environment, queue, database, or
  orchestration implementation and is absent from API and worker composition.
- No trust root, signing key, Temporal configuration, certificate, shared mount, route, service
  activation, provider, deployment, publication, spend, DNS change, or Level-4 action is added.
- A future carrier still needs bounded delivery, role-local composition, audited public-root
  provisioning, and independent infrastructure review.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

ADR-0124 no longer requires blind trust in future carrier metadata: an untrusted transport can carry
the protocol without becoming the application authentication authority. This does not select or
activate that transport, provision trust, expose the shared runtime mount, or establish a runtime
connection.
