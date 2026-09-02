# ADR-0083: Authenticated retained-native supervisor local IPC contract

Date: 2026-09-02

## Context

ADR-0082 closes the trust-check gap around one bounded retained-native recovery exchange, but its
transport remains an injected interface. A production worker must not treat possession of a Unix
socket path, caller-provided identity metadata, or a signed response alone as proof that it reached
the intended local supervisor. The supervisor must likewise authenticate the recovery worker before
allowing a challenge to reach retained process authority.

## Decision

Add an uncomposed Linux local IPC contract with separate worker-side transport and supervisor-side
handler boundaries:

1. every exchange is exactly one canonical, newline-terminated JSON frame in each direction and is
   limited to 32 KiB per frame;
2. frames bind schema version, protocol domain, direction, and the existing recovery request or
   response, while rejecting non-canonical encodings, extra frames, invalid UTF-8, and unknown keys;
3. an explicit authorization pins the absolute socket path, device, inode, owner UID/GID, owner-only
   read/write mode, and expected peer PID/UID/GID;
4. the worker-side native port must report `lstat(2)` Unix-socket identity before and after the
   exchange and connected `SO_PEERCRED`; all three must match the authorization exactly;
5. the supervisor-side handler accepts only an already-attested Unix-socket identity and exact
   worker `SO_PEERCRED` before decoding or invoking the existing authenticated supervisor peer; and
6. cancellation, concurrent worker-side exchange, incomplete composition, native errors, identity
   drift, and ambiguous framing deny without returning partial data.

The native client port is deliberately narrower than a generic socket API. Its future Linux
implementation is responsible for obtaining kernel evidence directly; the contract never grants
authority to metadata supplied by an IPC caller.

## Security and runtime-truth boundary

- Socket path discovery, endpoint creation, listener ownership, native `lstat(2)`/`SO_PEERCRED`
  implementation, process spawning, and worker scheduling are not provided.
- The pinned socket identity prevents transparent path replacement during an exchange; exact peer
  PID/UID/GID prevents a different same-host process from satisfying policy merely by reaching the
  socket.
- The existing two-second challenge lifetime remains the end-to-end time bound. This layer adds no
  independent retry, queue, fallback transport, or authority.
- The handler returns only the existing signed normalized response. It exposes no pidfd, process
  locator, cleanup handle, secret, credential, transcript, or private native error.
- Authorization remains explicitly `runtimeConnection: NOT_CONFIGURED`. This contract does not
  register, connect, promote, dispatch to, deploy, or spend through a real runtime.
- Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

The recovery worker and retained-native supervisor now have a fail-closed, mutually OS-authenticated
local IPC protocol boundary that can be implemented by a reviewed Linux native adapter. Production
composition still requires that adapter, protected socket lifecycle and authorization provisioning,
private-key custody, retained native supervisor service wiring, and the recovery worker composition.
The next safe slice is a Linux-native adapter evidence fixture for socket identity and peer
credentials, without installing a service or granting runtime status.
