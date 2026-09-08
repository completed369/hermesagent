# ADR-0161: Authenticated worker service-authority protocol

Date: 2026-09-08

## Context

ADR-0160 established a symmetric one-use signed carrier, but it deliberately defined no authority
message. The worker listener owner therefore still could not obtain the exact Level-3 grant that the
API coordinator can issue. Sending a bare grant, accepting a generic service request, or trusting a
structural carrier substitute would weaken the existing service-owner and transport boundaries.

## Decision

Define one strict request/response protocol for only
`TOPOLOGY_CARRIER_WORKER_LISTENER` authority. The request contains the exact validated service
request, its canonical hash, and the live carrier-binding hash. The response contains only the exact
fresh Level-3 grant for that request and repeats both hashes. Both messages preserve
`runtimeConnection: NOT_CONFIGURED` and have fixed opposite directions.

Add an API-side one-shot handler that validates the worker request against an injected expected
request and live binding before consuming an injected authority. Add a worker-side one-shot service
authority that invokes only the hidden-authenticated canonical worker carrier implementation,
validates the API response and grant, and closes the carrier on every attempted outcome.

Export the existing canonical service-grant validator so the protocol and service owner use the
same strict parser.

## Security and runtime-truth boundary

- The service kind, workspace, supervisor, expected API peer role, request hash, and carrier-binding
  hash must all match before authority is consumed or a grant is accepted.
- The API handler accepts only the expected request fixed at construction. The worker accepts only a
  grant whose request fields exactly reproduce its expected request and whose validity is current,
  positive, and at most one minute.
- The worker carrier has a hidden canonical-construction proof. Protocol invocation calls its class
  implementation directly, so structural, prototype, and instance-method substitution cannot bypass
  mutual Ed25519 verification.
- Authority exceptions are normalized to bounded denial. The carrier closes after every first
  authorization attempt, including request drift, tampering, stale grants, cancellation, and
  success. Both protocol roles deny replay.
- The protocol creates no signer, key, listener, socket, identity, authority, route, retry, daemon,
  or lifecycle. API/worker application entry points do not import or invoke it.
- No provider activation, deployment, publication, spend, DNS change, commercial commitment, or
  Level-4 action occurs.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

VentureOS now has a bounded protocol capable of carrying the exact worker-listener grant across the
existing authenticated boundary without allowing caller-controlled authority. Remaining work is to
compose the API issuer/endpoint and worker client/authority with separately authorized native
transport inputs, still without startup activation, before any approved runtime launch or
connectivity claim.
