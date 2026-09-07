# ADR-0135: Linux-authenticated topology carrier root lookup transport

Date: 2026-09-07

## Context

ADR-0131's worker source and ADR-0132/0134's API handler composition require a transport that
authenticates both roles independently of the public root being fetched. Treating caller-provided
role metadata or the returned root as transport identity would create circular trust. The existing
native IPC port already returns Linux `lstat(2)` endpoint evidence around client exchanges and
`SO_PEERCRED` process identity for connected peers.

## Decision

Add an exported but application-inactive worker transport and API inbound endpoint over the
existing closable local IPC port. Both are constructor-bound to the same live carrier authorization
and an exact local IPC authorization supplied by a later approved composition.

The worker adapter consumes one attempt, verifies the protocol's exact worker/API authorization,
sends only the bounded root-lookup request to the authorized socket path, and releases a defensive
response copy only after the native result proves the exact endpoint before and after exchange plus
the expected API PID, UID, and GID through `SO_PEERCRED`. It exposes close so cancellation or timeout
can actively close a non-cooperating native connection.

The API endpoint accepts one already-connected inbound exchange, authenticates the exact listener
endpoint and expected worker PID, UID, and GID, then derives the direction-specific sideband
authorization supplied to ADR-0132. The request remains untrusted protocol bytes and is parsed only
by ADR-0132 after kernel identity succeeds. Both adapters revalidate the short-lived carrier binding
before releasing a result and deny replay, substitution, malformed evidence, and cancellation.

## Security and runtime-truth boundary

- The returned public root authenticates neither the request nor its own transport. Linux endpoint
  identity and peer credentials are checked first against separately supplied exact authorization.
- The adapters import no filesystem, socket, network, TLS, process, environment, database, provider,
  private-key, or signing implementation. They discover no path and create no listener.
- The native client/listener, socket authorization, PID/UID/GID-to-role composition, writable shared
  mount, service ownership, route, and application wiring remain absent.
- No deployment, publication, provider activation, spend, DNS change, commercial commitment, or
  Level-4 action is introduced.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

The root-lookup protocol now has a concrete Linux kernel-authentication adapter without duplicating
native socket logic or trusting the root under retrieval. Remaining work includes the independently
authorized application composition, real shared runtime mount and route, listener ownership,
keyless carrier-signing transport, and a verified end-to-end runtime round trip.
