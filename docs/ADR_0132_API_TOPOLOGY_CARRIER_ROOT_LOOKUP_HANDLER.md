# ADR-0132: API topology carrier public-root lookup handler

Date: 2026-09-07

## Context

ADR-0131 defines the worker's protocol for fetching the API coordinator's public carrier root over
an independently mutually authenticated transport. The API side still needs a bounded handler that
does not trust identity claims in the request or let the returned root authenticate its own
delivery.

## Decision

Add an uncomposed, one-use API-side protocol handler. Its privileged caller must supply an inbound
authorization record produced independently by the authenticated transport. That record is exact
and direction-specific: local `API_COORDINATOR`, peer `WORKER_CLIENT`, both binding principals, the
carrier and binding hash, authentication time, binding deadline, and `NOT_CONFIGURED` runtime truth.
The handler accepts no authorization carried inside the untrusted request.

After authenticating that sideband identity, the handler accepts only the canonical 2 KiB ADR-0131
request for its immutable live binding. It verifies both role/principal pairs, the complete binding,
carrier, binding hash, fresh-challenge shape, and runtime truth before asking its injected public-root
source for exactly `API_COORDINATOR`. The source call is bounded by the earlier of the configured
deadline or binding expiry and receives propagated cancellation.

The returned public root must be structurally valid, non-revoked, match the coordinator principal and
binding hash, and cover the entire binding lifetime. Only then does the handler return a canonical,
4 KiB-bounded response echoing the complete request scope, challenge, and request hash. Binding and
cancellation are revalidated before release. Unknown source failures are normalized, and every
attempt consumes the handler.

## Security and runtime-truth boundary

- The sideband authorization is a privileged port contract. A future concrete listener must derive
  it from independent mutual peer authentication and integrity protection; request fields cannot
  mint it.
- The handler holds no private key, signs nothing, grants no provisioning or routing authority, and
  exposes only the exact coordinator public verification root already admitted for the binding.
- PostgreSQL access remains behind an injected source. No database adapter, TLS, network, socket,
  listener, route, provider, mount, process, or application composition is selected here.
- The handler remains absent from API and worker composition. Codex, Hermes, Pi, and
  `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

The client and server halves of the public-root lookup protocol now meet at a narrow, independently
authenticated boundary. Remaining work includes an API-local coordinator-root source adapter, a
concrete mutually authenticated transport/listener, keyless signing transport, carrier routing, the
missing shared runtime mount, and a verified end-to-end runtime round trip.
