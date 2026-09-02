# ADR-0086: Deny-default Linux retained-native supervisor session

Date: 2026-09-02

## Context

ADR-0085 gives the worker side a production-shaped owner for one authenticated local IPC exchange.
The supervisor-side ADR-0083 handler still receives already-framed evidence without a production-
shaped owner for accept, peer authentication, bounded request/response I/O, path revalidation, and
connection cleanup. Adding a real listener would also add bind, publication, service lifecycle,
filesystem ownership, and key-custody authority that this safe slice must not grant.

## Decision

Add an exported but unconfigured supervisor session owner over one injected Linux boundary:

1. the boundary may accept only from an already-created, already-authorized Unix listener path and
   exposes no create, bind, listen, chmod, unlink, discovery, loop, or retry operation;
2. the owner validates owner-only mode `0600` and exact socket device, inode, owner, and group before
   accept, immediately after accept and peer authentication, and again before releasing a response;
3. raw worker PID/UID/GID from `SO_PEERCRED` are validated before the owner derives the authority-
   labelled peer attestation passed to the authenticated ADR-0083 handler;
4. exactly one request is read through EOF with the 32 KiB protocol bound, exactly one authenticated
   response is written followed by write shutdown, and no reusable stream crosses the boundary;
5. every accepted session closes on success, cancellation, malformed evidence, native failure,
   protocol denial, listener substitution, or response failure; close failure denies the session;
6. owned request and response buffers are cleared, native error detail is withheld, and concurrent
   calls are denied; and
7. the operation returns no status or connectivity evidence.

The positive constructor requires an existing authenticated supervisor handler and an injected
Linux boundary. The exported deny boundary is the default representation of missing native support.

## Security and runtime-truth boundary

- The adapter cannot create or publish a listener, select a path, authorize a caller, retry, or run
  a service loop.
- Listener replacement is denied before the recovery handler may act and checked again before any
  response is released. Peer authority labels are derived only from validated raw kernel facts.
- The outer two-second challenge and abort boundary remains authoritative; a future native boundary
  must honor the provided abort signal for every potentially blocking operation.
- No native implementation, socket path provisioning, private-key custody, supervisor service,
  worker composition, provider, deployment, publication, spend, or runtime promotion is activated.
- Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

Both sides of one authenticated retained-native supervisor exchange now have bounded, deny-default
lifecycle owners without a real listener or runtime wiring. Remaining production work includes the
concrete native boundary, protected listener creation and ownership, authorization provisioning,
private-key custody, supervisor service lifecycle, recovery-worker composition, and a verified
authenticated round trip. The next safe slice is a deny-default listener lifecycle authorization
contract that proves pre-existing path absence and ownership-safe cleanup without opening a socket.
