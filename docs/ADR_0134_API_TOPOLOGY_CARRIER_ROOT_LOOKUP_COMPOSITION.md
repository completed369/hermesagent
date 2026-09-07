# ADR-0134: Inert API topology carrier root lookup composition

Date: 2026-09-07

## Context

ADR-0132 defines the authenticated API-side coordinator-root lookup handler, and ADR-0133 defines a
separate least-authority PostgreSQL source for the coordinator's own published public grant. Leaving
them unrelated avoids accidental activation, but the intended source-to-handler dependency still
needs one auditable construction boundary before a concrete listener can be considered.

## Decision

Add an API-local factory that constructs one ADR-0133 source and injects it into one ADR-0132
handler for the same binding, clock, and bounded timeout. The source remains dedicated to
`API_COORDINATOR`; the factory exposes no principal-role selector and the handler remains one-use.

Construction validates the binding and dependencies but performs no database read and accepts no
request. Database access can occur only after the handler has validated independently authenticated,
direction-specific sideband identity and the exact canonical worker request. Existing source and
handler cancellation, expiry, framing, root-scope, and replay constraints remain authoritative.

## Security and runtime-truth boundary

- The factory is absent from the Nest module and worker graph. It creates no provider or service.
- It does not select or open a listener, route, socket, TLS session, network connection, process, or
  shared mount and cannot manufacture the sideband mutual-authentication evidence the handler needs.
- It receives no private key and performs no signing, provisioning, deployment, publication, or
  runtime action.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

The API now has a single reviewable source-to-handler construction boundary without activating it.
Remaining work includes a concrete independently mutually authenticated listener/transport,
keyless signing transport, carrier routing, the missing shared runtime mount, and a verified
end-to-end runtime round trip.
