# ADR-0084: Linux retained-native local IPC kernel evidence

Date: 2026-09-02

## Context

ADR-0083 defines the authenticated local IPC contract but intentionally leaves its Linux native port
unimplemented. Pure TypeScript adversarial tests prove contract behavior against supplied evidence;
they do not prove that Linux exposes the pinned Unix-socket identity and bidirectional peer
credentials in the required shape.

## Decision

Add a Linux-x64-only native integration fixture that is compiled during the Agent Bridge test suite
and excluded from runtime output. For each one-shot exercise it:

1. refuses an existing filesystem path, creates an `AF_UNIX` stream listener only beneath the
   test-owned temporary directory, changes it to exact mode `0600`, and retains its device/inode
   identity;
2. records `lstat(2)` identity before and after the exchange and requires device, inode, owner,
   file type, and mode to remain exact;
3. connects and accepts within the test process, reads `SO_PEERCRED` from both connected endpoints,
   and requires PID/effective UID/effective GID to equal the process that established the connection;
4. transfers and compares one bounded request frame and one bounded response frame byte-for-byte;
5. feeds the kernel-derived supervisor credentials through the ADR-0083 worker transport and the
   kernel-derived worker credentials through the supervisor handler; and
6. closes descriptors, zeroes private frame copies, removes only the exact socket identity it
   created, and rejects replay, oversized frames, wrong pinned peer identity, and path substitution.

If an attacker replaces the path after preparation, cleanup compares device/inode/type before
unlinking and therefore leaves the substituted object untouched.

## Security and runtime-truth boundary

- The fixture is synchronous, test-only, Linux-x64-only, and absent from package exports and runtime
  build output. It is not a reusable production adapter or supervisor service.
- It creates no persistent listener, worker, scheduler, service unit, root/trust record, private
  signing key, provider connection, deployment, publication, or spend.
- Same-process endpoints make the expected credentials deterministic while exercising the real
  kernel `SO_PEERCRED` and Unix-socket filesystem semantics. This is evidence for the port contract,
  not proof of process separation or production service custody.
- All resulting contract state remains `runtimeConnection: NOT_CONFIGURED`; Codex, Hermes, and Pi
  remain `NOT_CONFIGURED`.

## Consequences

The IPC contract now has executable Linux kernel evidence for exact endpoint identity, both peer
credential directions, bounded frame transfer, path-substitution denial, and ownership-safe cleanup.
Production composition still requires a reviewed asynchronous native adapter, protected socket and
service lifecycle, authorization provisioning, private-key custody, retained-native supervisor
service wiring, and recovery-worker wiring. The next safe slice is the production-shaped but
deny-default Linux native adapter boundary, still without creating a listener or connecting a real
runtime.
