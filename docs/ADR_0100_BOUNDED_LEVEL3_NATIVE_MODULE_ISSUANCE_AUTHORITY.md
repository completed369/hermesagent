# ADR-0100: Bounded Level-3 native-module issuance authority

Date: 2026-09-06

## Context

ADR-0098 defines a deny-default authority port for native-module authorization snapshot issuance,
and ADR-0099 durably records the admitted approval evidence. The only existing application approval
bridge is intentionally Founder-gated Level 4. Reusing it would cross the Level-4 boundary, while
leaving the Level-3 port entirely abstract prevents safe control-plane composition from advancing.

## Decision

Add an exported but uncomposed API-side authority adapter that:

1. accepts only a trusted `CONTROL_PLANE` capability exactly bound to authority Level 3 and a
   non-runtime workspace principal;
2. is constructed for one exact, inert, plain-record issuance-authority request and denies tenant,
   supervisor, snapshot, signer, request-hash, or runtime-truth drift;
3. can be attempted only once and emits a fixed one-minute authorization window from an injected,
   range-checked clock;
4. domain-separates and hashes the exact request, principal, actor kind, authority level, policy
   version, and authorization window into digest-only approval evidence; and
5. returns only the grant shape already independently validated by the ADR-0098 controller and
   durably bound by ADR-0099.

## Security and runtime-truth boundary

- Level 4 is rejected rather than treated as “at least Level 3,” and the Founder approval service is
  neither imported nor invoked.
- Runtime principals, AI-COO capabilities, cross-workspace bindings, replay, drift, accessors, symbol
  properties, custom prototypes, invalid clocks, and private-looking references fail closed.
- The adapter has no signer or private-key access, cannot publish a snapshot, and cannot load a
  module, open a socket, start a process, contact a provider, or update runtime status.
- No Nest module, route, worker, scheduler, or service loop constructs the adapter.
- No deployment, publication, spend, DNS change, or commercial/legal commitment occurs. Codex,
  Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

The issuance controller now has a reviewed non-Founder-gated authority implementation suitable for
a later explicit composition root. Production trust-root and signing-key provisioning, signer
custody, service ownership, native loading, authenticated runtime wiring, and a verified round trip
remain unfinished and require separate review.
