# ADR-0133: API coordinator published topology carrier root source

Date: 2026-09-07

## Context

ADR-0132 adds the authenticated API-side handler for the worker's coordinator-root lookup. The
durable public-root registry can read either carrier role, but the existing API adapter intentionally
permits only the opposite `WORKER_CLIENT` root used by coordinator-side carrier authentication. The
handler needs a separate least-authority source for the API coordinator's own published public grant.

## Decision

Add a one-use API-local source adapter dedicated to `API_COORDINATOR`. It binds one immutable, live
carrier authorization and delegates to the existing PostgreSQL public-root registry using the exact
coordinator role. It denies the worker role, binding substitution, pre-cancellation, missing or
ambiguous state, database failure, replay, and any result released after cancellation or binding
expiry.

The returned public record must be version 1, non-revoked, match the binding's coordinator principal
and hash, and cover the complete binding lifetime. The adapter contains no private key and does not
sign, provision, authenticate a peer, or select a transport. It remains separate from the existing
worker-root adapter so neither caller gains a role selector.

## Security and runtime-truth boundary

- PostgreSQL remains API-local and is reached only through the injected narrow query client.
- This source proves only that an already Level-3-admitted public grant exists for the exact live
  binding. It grants no signing, routing, listener, provisioning, or runtime authority.
- The source and ADR-0132 handler both remain absent from the Nest module. No socket, TLS, network,
  route, concrete mutual-authentication mechanism, mount, process, deployment, or publication is
  introduced.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

The API now has a least-authority durable source suitable for injection into the authenticated
coordinator-root lookup handler. Remaining work includes their bounded composition behind a concrete
independently mutually authenticated listener/transport, keyless signing transport, carrier routing,
the missing shared runtime mount, and a verified end-to-end runtime round trip.
