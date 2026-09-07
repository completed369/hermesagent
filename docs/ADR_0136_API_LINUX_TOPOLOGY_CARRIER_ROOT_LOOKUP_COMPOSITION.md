# ADR-0136: Inert API Linux topology carrier root lookup composition

Date: 2026-09-07

## Context

ADR-0134 binds the API's PostgreSQL coordinator-root source to the authenticated protocol handler.
ADR-0135 separately authenticates an already-accepted Linux IPC exchange before deriving the
handler's sideband identity. The API needs one reviewable construction boundary joining those
pieces without registering a listener or turning injected OS authorization into ambient authority.

## Decision

Extend the existing API-local factory with a second factory that constructs the ADR-0134 handler
and wraps it in the ADR-0135 Linux inbound endpoint for the same exact carrier binding and clock.
The exact local IPC authorization is an explicit constructor input; no path, PID, UID, GID, socket,
or listener is discovered or inferred.

Construction validates all dependencies but performs no database read. An accepted request can
reach PostgreSQL only after the Linux endpoint proves the exact injected socket identity and worker
`SO_PEERCRED` PID, UID, and GID, and after the inner handler validates the canonical request against
the same live carrier authorization. Both inner layers remain one-use and fail closed.

## Security and runtime-truth boundary

- The factory is absent from the Nest module and worker graph. It opens no listener and starts no
  service or lifecycle.
- It imports no native implementation, path source, filesystem, socket, network, TLS, process,
  environment, key, signer, provider, deployment, or publication capability.
- The approved OS-principal authorization, native listener, socket route, shared writable mount,
  service ownership, and application activation remain unfinished.
- No spend, DNS change, commercial commitment, or Level-4 action is introduced.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

The API now has an inert database-to-kernel-authenticated-endpoint construction boundary that
cannot be reached from the running service graph. Remaining work includes the worker-side native
composition, approved role/OS-principal mapping, listener ownership, shared mount and route,
keyless carrier signing, and a verified end-to-end runtime round trip.
