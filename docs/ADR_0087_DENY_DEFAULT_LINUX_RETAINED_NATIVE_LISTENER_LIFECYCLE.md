# ADR-0087: Deny-default Linux retained-native listener lifecycle

Date: 2026-09-02

## Context

ADR-0086 owns one authenticated supervisor session only after an authorized Unix listener already
exists. A production supervisor must eventually create and remove that listener without replacing an
unknown path, exposing it through a permissive directory, or removing a path whose identity changed.
Granting ordinary filesystem or socket APIs to the protocol layer would make those ownership rules
implicit and would broaden this safe slice into service activation.

## Decision

Add an exported but unconfigured owner for one injected Linux listener lifecycle:

1. authorization pins an absolute socket path, exact parent device/inode/UID/GID with mode `0700`,
   socket UID/GID with mode `0600`, backlog `1`, Linux platform, and `NOT_CONFIGURED` runtime truth;
2. the frozen native request requires atomic `FAIL_IF_PRESENT` creation and cannot authorize path
   replacement;
3. native creation evidence must prove that the path was absent, the bind was completed without
   replacement, the parent identity is exact, and the created object is the authorized Unix socket;
4. the listener is re-stat'd before accept and the existing ADR-0086 owner then handles exactly one
   peer-authenticated, bounded request and response;
5. the native listener handle must retain the created device/inode internally, synchronously close
   the listener, re-stat the path, and remove it only if it remains the exact owned socket;
6. cleanup runs from `finally` on success, cancellation, invalid creation evidence, substitution,
   session denial, or native failure; missing or inconsistent cleanup evidence denies the operation;
   and
7. the lifecycle instance is consumed by its first attempt and provides no retry or service loop.

The native factory contract may return an allocated listener only as the complete owned-listener
handle. Once returned, cleanup cannot depend on parsed or caller-supplied identity. The exported deny
binding remains the default representation of missing native support.

## Security and runtime-truth boundary

- The protocol layer receives no filesystem, socket, process, discovery, path-selection, or key-
  custody authority. Atomic creation and identity-owned removal remain obligations of the injected
  native boundary.
- Synchronous cleanup prevents an already-aborted signal or an ignored asynchronous teardown from
  stranding a listener. A substituted path must be preserved and reported as denial rather than
  removed.
- Parent and listener identity, ownership, mode, path disposition, backlog, and platform are exact;
  extra fields, accessors, malformed native objects, and error detail deny closed.
- No concrete native implementation, socket path provisioning, private-key custody, supervisor
  service, worker composition, provider, deployment, publication, spend, or runtime promotion is
  activated.
- Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

The repository now defines the full deny-default ownership envelope around one authenticated local
supervisor exchange, including protected creation and cleanup, without opening a socket. Remaining
production work includes a concrete native Linux implementation, authorization and key provisioning,
the bounded supervisor service lifecycle, worker composition, and a verified authenticated runtime
round trip. The next safe slice is test-only Linux kernel evidence for the native listener lifecycle;
it must prove no-replacement creation, exact metadata, substitution-safe cleanup, and bounded accept
without introducing runtime composition.
