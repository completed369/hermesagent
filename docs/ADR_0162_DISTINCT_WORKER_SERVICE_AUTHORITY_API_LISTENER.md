# ADR-0162: Distinct worker service-authority API listener

Date: 2026-09-08

## Context

ADR-0161 defined the authenticated worker-listener grant protocol, but the API had no distinct
authorized listener purpose on which to serve it. Reusing the carrier-root lookup listener would
permit protocol switching and couple two separately bounded authorities.

## Decision

Add `TOPOLOGY_CARRIER_WORKER_SERVICE_AUTHORITY_API_LISTENER` as a separate retained-native
one-session service kind. It always expects a `WORKER_CLIENT` kernel peer. Add a service-owner method
that requires the exact canonical bounded frame endpoint, a fresh live carrier binding, and a
Level-3 grant for this new purpose before creating one owned listener, authenticating one accepted
worker session, handling one frame, and performing exact session/listener cleanup.

The method reuses the existing bounded accepted-session machinery; it does not multiplex with or
alter carrier-root lookup.

## Security and runtime-truth boundary

- The new service kind has its own canonical request hash and therefore its own Level-3 approval,
  grant, service-run identity, socket path, and peer credentials.
- Its expected peer role is fixed to `WORKER_CLIENT`; caller-selected role drift is rejected before
  authority or listener creation.
- The carrier binding must match the authorized workspace and supervisor before any accepted frame
  can be handled.
- Only an endpoint carrying the canonical constructor's hidden authenticity proof is admitted;
  prototype-forged endpoints are rejected before authority is consulted or a listener is created.
  The canonical bounded 64 KiB one-frame endpoint's existing timeout,
  kernel-attested peer admission, one-use transfer, response shutdown, accepted-session close, and
  owned-listener unlink rules remain unchanged.
- No protocol handler, issuer, signer, root, module, path, identity, route, or startup input is
  selected. Application entry points remain unchanged.
- No provider activation, deployment, publication, spend, DNS change, commercial commitment, or
  Level-4 action occurs.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

The API can now authorize a listener purpose dedicated solely to worker service-authority delivery,
without weakening root-lookup isolation. Remaining work is to compose its loaded native listener,
exact Level-3 listener authority, ADR-0161 handler, API signer, and worker public root as one inactive
API application boundary, then compose the matching worker client.
