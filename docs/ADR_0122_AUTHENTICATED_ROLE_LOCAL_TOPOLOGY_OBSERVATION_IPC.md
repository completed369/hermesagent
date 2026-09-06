# ADR-0122: Authenticated role-local topology observation IPC

Date: 2026-09-06

## Context

ADR-0120 requires two separately obtained role-local observations before it can attest shared
runtime topology. Its observation ports were deliberately untransported. Accepting a matching path,
caller-supplied process identity, or arbitrary JSON response as role evidence would let a coordinator
mistake an unauthenticated process for the API/LISTENER or worker/CLIENT observer.

The repository already has one reviewed Linux local IPC client boundary that retains the endpoint
identity around an exchange and obtains the connected peer identity from `SO_PEERCRED`. A topology
protocol should reuse that boundary rather than add another socket implementation.

## Decision

Add one-use coordinator-side transport and role-local handler adapters for topology observations.
Both use the existing owner-only Unix-socket authorization and require exact endpoint device/inode,
owner UID/GID, mode, path, and peer PID/UID/GID evidence.

Each exchange contains one canonical newline-terminated JSON request and response, limited to 32 KiB.
The envelope binds protocol, direction, exact observer role, request hash, and
`runtimeConnection: NOT_CONFIGURED`. Both sides independently validate the complete observation
request; both independently validate the exact fresh retained-descriptor observation before it can
cross their boundary. Role drift, request substitution, non-canonical encoding, endpoint or peer
replacement, timeout, cancellation, replay, malformed evidence, or failure to close denies without
returning a partial result.

## Security and runtime-truth boundary

- The adapters capture injected methods at construction and reject the default deny ports.
- The coordinator adapter actively closes the native client on cancellation or its bounded timeout.
- The handler cannot return extra fields or file contents because its result passes the exact ADR-0120
  observation validator before encoding.
- No socket or listener is created, discovered, selected, or activated. The adapters supply no
  distributed carrier between containers and no shared mount.
- The adapters remain absent from API and worker composition roots. Current private staging cannot
  use them as end-to-end topology evidence without separately reviewed local listener lifecycles,
  distributed orchestration, exact authorizations, and a shared runtime mount.
- No runtime is provisioned, activated, connected, registered, or promoted. Providers, credentials,
  deployment, publication, spending, DNS, legal commitments, and Level 4 remain out of scope.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

Topology observation now has a canonical mutually kernel-authenticated local exchange instead of an
arbitrary injected call. Protected listener lifecycle, authorization issuance, the cross-container
carrier/orchestration choice, and shared-mount deployment topology remain explicit prerequisites to
composing ADR-0121 or claiming any runtime connection.
