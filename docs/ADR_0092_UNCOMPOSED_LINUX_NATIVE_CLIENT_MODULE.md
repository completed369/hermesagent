# ADR-0092: Uncomposed Linux retained-native client module

Date: 2026-09-05

## Context

ADR-0091 fixes the worker-side native ABI and rejects drift, malformed handles, unordered use, and
uncleared frame copies, but deliberately supplies no syscall implementation. The next boundary must
prove that connecting and exchanging through that ABI can be asynchronous, cancellable, bounded,
and grounded in kernel identity without selecting a production path or loading a binary.

## Decision

Add a source-only Linux N-API module behind the ADR-0091 injected ABI:

1. it exports exactly the own data properties `{ abiVersion: 1, platform: 'LINUX',
lstatUnixSocket, connectUnixSocket }`, and each connected handle exports exactly
   `peerCredentials`, `writeAndShutdown`, `readToEof`, and `close`;
2. it validates a bounded absolute `.sock` path at the syscall boundary, derives owner-only socket
   identity with `lstat(2)`, creates a nonblocking close-on-exec `AF_UNIX` stream socket, completes
   nonblocking `connect(2)` with `poll(2)` plus `SO_ERROR`, and derives the supervisor identity only
   from `SO_PEERCRED`;
3. connect, bounded write/shutdown, and bounded read-to-EOF run as N-API async work. Each operation
   owns a private close-on-exec cancellation pipe registered with its supplied `AbortSignal`, so an
   abort wakes `poll(2)` without cross-thread closure or descriptor reuse;
4. each connection permits only peer-credentials, one 32 KiB-bounded write with `MSG_NOSIGNAL`, one
   32 KiB-bounded read, and close in that order. It copies request bytes before background use and
   clears native request and response storage;
5. Linux-x64 tests compile the production source with warnings as errors and hardening flags, load it
   only from a test-owned temporary directory, exercise a complete authenticated exchange, prove a
   pending read is abortable, and prove final `lstat(2)` rejects a substituted socket identity; and
6. the authenticated evidence retains `runtimeConnection: 'NOT_CONFIGURED'`; kernel execution is not
   runtime composition or an external provider connection.

## Security and runtime-truth boundary

- The repository contains source only. There is no binary loader, committed `.node` artifact,
  selected socket path, directory provisioner, process launcher, retry loop, service wiring, or API
  or worker composition.
- The package runtime allowlist remains `dist` only. Tests compile into and remove a disposable
  directory outside the repository.
- The module grants no trust snapshot, key custody, authorization provisioning, provider,
  deployment, publication, spending, or Level-4 authority.
- Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

Both retained-native Unix-socket endpoints now have reviewable, reproducibly compiled Linux source
behind exact deny-default ABIs. The next safe slice is an equally bounded loader and path
authorization boundary; it must not compose either module or promote runtime truth until retained
trust, process ownership, and end-to-end authorization are available.
