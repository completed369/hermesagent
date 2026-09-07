# ADR-0131: Worker topology carrier public-root lookup boundary

Date: 2026-09-07

## Context

ADR-0130 gives the API coordinator a local source for the worker's public carrier root. The worker
still needs the API coordinator's root, but must not couple to PostgreSQL. The returned root also
cannot authenticate its own delivery: doing so would create circular trust and allow an endpoint to
self-assert the identity whose key is being fetched.

## Decision

Add an uncomposed, one-use worker source over an injected privileged transport port. That transport
must independently authenticate both the worker and API coordinator and protect exchange integrity;
the source passes it the exact expected local and peer roles, principals, carrier, binding hash, and
binding deadline. No TLS, network, socket, route, or provider implementation is selected here.

The source requests only the exact `API_COORDINATOR` root for its immutable live binding. Each
canonical request carries the complete validated binding, a fresh 256-bit challenge, both
role/principal pairs, the carrier and binding hash, and `NOT_CONFIGURED` runtime truth. The
canonical response must echo the complete
scope, challenge, and request hash and return a structurally valid, non-revoked coordinator root
whose validity covers the complete carrier binding. Requests are limited to 2 KiB and responses to
4 KiB.

Cancellation and the earlier of the configured deadline or binding expiry abort the exchange. The
transport is closed under a separate bounded deadline after every attempted read, and no root can
escape until close succeeds. Binding and cancellation are rechecked after close. Unknown transport,
close, framing, root, clock, and challenge failures deny without exposing their details; an attempted
read consumes the source.

## Security and runtime-truth boundary

- Independent transport authentication is a required privileged port contract, not an assertion
  inside the untrusted response. A future concrete adapter must supply and verify that identity.
- The source accepts no worker-root lookup, binding drift, role substitution, replayed challenge,
  response scope drift, revoked root, or root whose validity fails to cover the binding.
- The source holds no private key, performs no signing, and grants no provisioning or routing
  authority. PostgreSQL remains API-local.
- The source remains absent from worker and API composition. No endpoint, carrier route, signing
  service, shared mount, process, deployment, publication, spend, DNS change, or Level-4 action is
  introduced.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

The worker side now has a narrow non-circular protocol boundary for obtaining the exact coordinator
verification root. Remaining work includes the API-side authenticated lookup handler, a concrete
independently authenticated transport, keyless signing transport, carrier routing, the missing
shared runtime mount, and a verified end-to-end runtime round trip.
