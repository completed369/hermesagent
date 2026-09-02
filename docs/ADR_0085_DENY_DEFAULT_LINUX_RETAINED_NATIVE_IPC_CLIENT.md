# ADR-0085: Deny-default Linux retained-native IPC client adapter

Date: 2026-09-02

## Context

ADR-0083 defines the authenticated local IPC protocol and ADR-0084 proves its kernel evidence in a
test-only native fixture. The worker-side contract still lacks a production-shaped owner for the
ordered native operations. Direct composition must not be possible through ambient filesystem or
network APIs, an unverified path, a reusable stream, or caller-authored attestation labels.

## Decision

Add an exported but unconfigured worker-side adapter over one explicit Linux native syscall binding:

1. the binding is Linux-only and exposes only `lstat` of an already-authorized Unix-socket path and
   connection of that exact path;
2. a connection exposes kernel peer credentials, one bounded write followed by write shutdown, one
   bounded read through EOF, and close—no generic stream or listener authority crosses the port;
3. the adapter validates raw socket type/device/inode/owner/mode and raw PID/UID/GID, then creates the
   ADR-0083 authority-labelled attestations itself;
4. exact owner-only mode `0600`, safe absolute socket paths, safe integer identities, and exact
   before/after socket identity are mandatory;
5. every opened connection is closed on success, cancellation, malformed evidence, framing failure,
   endpoint replacement, or native error; close failure denies the exchange; and
6. concurrent exchange, retry, path discovery, listener creation, fallback transport, and runtime
   status promotion are absent.

The only positive constructor requires an injected native binding. The exported deny binding is the
default representation of missing native support. No concrete binding or runtime composition is
included.

## Security and runtime-truth boundary

- The adapter cannot create, bind, listen on, discover, replace, chmod, or unlink a socket.
- Caller-provided objects cannot assert `LINUX_LSTAT_UNIX_SOCKET` or `LINUX_SO_PEERCRED`; those labels
  are added only after the adapter validates raw values from its injected native boundary.
- One request is copied into adapter ownership and cleared after close. A response that cannot cross
  the boundary is cleared before denial.
- The outer two-second challenge/abort boundary remains authoritative; the native implementation is
  required to honor the provided abort signal for every syscall operation.
- No service, worker, scheduler, private key, root/trust publisher, provider, deployment, publication,
  spend, registration, connection, or runtime promotion is activated.
- Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

The worker side now has a production-shaped lifecycle owner that can consume a future reviewed Linux
native binding without weakening the ADR-0083 protocol. Remaining production work includes the
concrete native binding, protected supervisor listener/service lifecycle, authorization provisioning,
private-key custody, supervisor handler service wiring, and recovery-worker composition. The next
safe slice is the deny-default supervisor listener/session adapter boundary, still without binding a
real socket or enabling runtime status.
