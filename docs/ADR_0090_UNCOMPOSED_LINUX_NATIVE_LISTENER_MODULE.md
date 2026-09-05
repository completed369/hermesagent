# ADR-0090: Uncomposed Linux retained-native listener module

Date: 2026-09-02

## Context

ADR-0089 fixes the production-facing JavaScript ABI but deliberately supplies no native
implementation. The next boundary must prove that potentially blocking Unix-socket operations can
execute without holding the Node.js event loop, while retaining the no-replacement creation and
identity-owned cleanup rules already proven by ADR-0088.

## Decision

Add a source-only Linux N-API module behind the ADR-0089 injected ABI:

1. it exports exactly the own data properties `{ abiVersion: 1, platform: 'LINUX',
createOwnedListener }` and validates the fixed creation request again at the syscall boundary;
2. it requires an existing owner-only parent, refuses any existing target, creates one nonblocking
   `AF_UNIX` stream socket with close-on-exec, binds without replacement, pins the created device and
   inode across exact mode `0600`, revalidates the parent identity, and listens with backlog `1`;
3. potentially blocking accept, bounded read-to-EOF, and bounded write/shutdown run as N-API async
   work. Each operation owns a private close-on-exec cancellation pipe registered with its supplied
   `AbortSignal`, so cancellation wakes `poll(2)` without closing or reusing the authority-bearing
   socket descriptor from another thread;
4. the module permits one accept and ordered peer-credentials, read, write, close, and cleanup
   operations. It derives peer identity from `SO_PEERCRED`, enforces the exact 32 KiB frame ceiling,
   copies response bytes before background use, clears native frame storage, and uses `MSG_NOSIGNAL`;
5. synchronous listener cleanup closes the retained descriptor and unlinks only a path whose device,
   inode, owner, group, type, and mode still equal the created identity. A substituted path is
   preserved; and
6. Linux-x64 tests compile the production source with warnings as errors and hardening flags, load it
   only from a test-owned temporary directory, exercise a complete authenticated kernel round trip,
   prove an idle accept is abortable without blocking the event loop, and prove substitution-safe
   cleanup.

## Security and runtime-truth boundary

- The repository contains reviewed native source but no binary loader, installed `.node` artifact,
  selected socket path, directory provisioner, service loop, or API composition.
- The package runtime allowlist remains `dist` only. Tests create a disposable binary outside the
  repository; no compiled artifact is published or committed.
- The module grants no key custody, authorization source, worker launch, provider, deployment,
  publication, spending, or Level-4 authority.
- A same-process test client proves kernel and asynchronous ABI behavior, not a configured external
  runtime. Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

The first production-native listener implementation is now reviewable and reproducibly exercised
behind the deny-default ABI without activating it. The next safe slice is an equally bounded Linux
native client implementation behind the existing ADR-0085 client contract, still injected,
unloaded, pathless, and uncomposed.
