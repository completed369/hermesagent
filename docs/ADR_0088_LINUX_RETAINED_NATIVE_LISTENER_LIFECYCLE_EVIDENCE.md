# ADR-0088: Linux retained-native listener lifecycle kernel evidence

Date: 2026-09-02

## Context

ADR-0087 defines a deny-default listener lifecycle and now constructs its authenticated handler only
after atomic creation supplies the socket device/inode. Pure TypeScript tests prove the trust order
against injected evidence, but they do not prove Linux no-replacement bind behavior, parent and socket
metadata, accepted peer credentials, or substitution-safe unlink against the kernel.

## Decision

Add a Linux-x64-only native integration fixture, compiled during the Agent Bridge test suite and
excluded from runtime output. Each one-shot exercise:

1. requires the test-owned parent to be a real directory with exact mode `0700`, observes the target
   as absent, creates an `AF_UNIX` stream listener without replacing a path, changes it to exact mode
   `0600`, listens with backlog `1`, and retains its complete identity;
2. returns exact creation evidence for the parent and listener, and re-stats the listener before
   connect, after accept, and before response release through the ADR-0087/ADR-0086 owners;
3. establishes the worker endpoint in-process, accepts it, reads real Linux `SO_PEERCRED`, and binds
   those credentials to the authorization-pinned worker PID/UID/GID before recovery peer effects;
4. transfers one request and one response through EOF with the 32 KiB protocol bound and compares the
   response byte-for-byte at the worker endpoint;
5. closes the accepted session and listener synchronously, then unlinks only if path device, inode,
   owner, group, file type, and mode still equal the retained created identity; and
6. refuses pre-existing targets and unsafe parent mode, rejects peer-credential drift, and preserves a
   substituted path.

## Security and runtime-truth boundary

- The native addon and its TypeScript wrapper are test-only, Linux-x64-only, unexported, and denied by
  the package runtime-output assertion.
- Same-process endpoints make expected credentials deterministic while exercising real Unix socket,
  filesystem, `lstat(2)`, and `SO_PEERCRED` behavior. This is kernel evidence, not process-separation
  or service-custody proof.
- The fixture owns one listener and one session, has no retry or service loop, clears native frame
  buffers, and uses only a test-owned temporary directory.
- No production native binding, path provisioning, service installation, private-key custody, worker
  composition, provider, deployment, publication, spend, or runtime promotion is activated.
- Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

The protected listener lifecycle now has executable kernel evidence for its creation, authentication,
bounded exchange, and cleanup invariants. Remaining production work includes a reviewed asynchronous
native binding, authorization and key provisioning, a bounded supervisor service owner, recovery-worker
composition, and a verified authenticated runtime round trip. The next safe slice is the deny-default
production native listener binding surface, still uncomposed and without selecting or provisioning a
real socket path.
