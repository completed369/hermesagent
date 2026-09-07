# ADR-0160: Worker-initiated authenticated topology carrier

Date: 2026-09-08

## Context

ADR-0159 completed an inactive API-to-worker carrier exchange, but the worker still had no bounded,
mutually authenticated route for requesting an exact service grant from the API coordinator. A raw
worker-initiated carrier would let transport-controlled bytes reach an authority handler, while
accepting a caller-supplied grant would make the worker its own authority.

## Decision

Add the symmetric worker-initiated adapter to the existing Ed25519 topology-carrier boundary. The
worker signs one request with its externally held key, verifies one API-coordinator-signed response
against the exact live carrier binding, and closes the injected carrier explicitly. Add the matching
API endpoint, which verifies the worker envelope before passing only its authenticated inner message
to an injected handler and signs the handler response as the API coordinator.

Both sides are one-use. Roots must retain their exact `WORKER_CLIENT` or `API_COORDINATOR` role,
principal, validity, revocation, and carrier-binding scope. Signers and byte carriers remain injected
ports with deny-only defaults.

## Security and runtime-truth boundary

- Transport-controlled envelopes are strict, bounded, inert JSON and are verified before an
  application handler receives their inner message.
- Worker requests require the exact worker root and signature; API responses require the exact
  coordinator root and signature. Role substitution, binding drift, revocation, tampering, replay
  through the one-use endpoint, cancellation, and deny-only dependencies fail closed.
- Application handlers cannot substitute delivery evidence: the endpoint strips the authenticated
  transport wrapper before dispatch and constructs fresh signed response evidence.
- Private keys remain outside this module. It cannot create keys, discover configuration, open a
  socket, select a route, issue service authority, or activate a lifecycle.
- This change defines no service-grant request or response schema and accepts no grant. That
  authority protocol remains the next dependency.
- Neither application entry point imports or invokes the new classes.
- No provider activation, deployment, publication, spend, DNS change, commercial commitment, or
  Level-4 action occurs.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

The worker and API coordinator can now be joined by a bounded authenticated request/response carrier
without granting either raw transport input or a caller-controlled authority object. Remaining work
is to define and compose the exact service-authority request, issuance, response, and worker-side
validation protocol over this inactive carrier, then supply Founder-approved production launch
inputs before any runtime activation or connectivity claim.
