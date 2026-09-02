# ADR-0089: Deny-default Linux retained-native listener binding ABI

Date: 2026-09-02

## Context

ADR-0088 proves the listener lifecycle against a test-only Linux native addon. The production
package still needs a reviewable boundary between that lifecycle and a future native implementation.
Loading a native binary, selecting a socket path, or accepting an unconstrained JavaScript object in
the same slice would combine ABI review with installation and service activation authority.

## Decision

Add an exported but uncomposed production-facing adapter for one injected native listener module:

1. the module has the exact data-property ABI `{ abiVersion: 1, platform: 'LINUX',
createOwnedListener }`; accessors, extra exports, alternate versions, alternate platforms, and the
   explicit deny module are rejected without invocation, and validated functions are captured so
   later property replacement cannot change authority;
2. one adapter permits one creation attempt and forwards only a frozen clone of the exact ADR-0087
   `FAIL_IF_PRESENT`, mode `0600`, backlog `1`, absolute bounded Unix-socket request;
3. returned listener and accepted-session handles must expose their required operations as own data
   functions. The adapter pins stat and accept to the exact created path and enforces
   creation-attestation-before-stat, a single accept, peer-before-read, one exact 32 KiB-bounded read,
   write-before-close, and one cleanup;
4. the response is copied into adapter-owned memory for the native write and cleared after the write
   settles;
5. if cancellation wins while native creation resolves, the allocated listener is synchronously
   closed and identity-owned cleanup is attempted before denial;
6. listener cleanup must remain synchronous. Promise-returning cleanup, duplicate operations,
   malformed handles, cancellation, and native failures deny with stable public error codes and do not
   disclose native details; and
7. the adapter never loads a module, discovers or provisions a path, retries, loops, chooses an
   authorization, or changes runtime truth.

## Security and runtime-truth boundary

- This is an ABI and handle-state boundary, not a native syscall implementation. The repository still
  contains no production `.node` listener addon or native binary loader.
- The adapter grants no filesystem, socket-path selection, process, key-custody, worker, provider,
  deployment, publication, or spending authority.
- It is exported for later reviewed composition but is absent from the API control-plane composition.
- Codex, Hermes, and Pi remain `NOT_CONFIGURED`; an injected fake or ABI-conformant handle is not a
  verified runtime connection.

## Consequences

The future native module now has a narrow, testable production ABI and cannot expand the TypeScript
lifecycle contract through extra exports or out-of-order handles. The next safe slice is a reviewed
Linux N-API listener implementation and build evidence behind this ABI, still uncomposed and without
selecting or provisioning a real socket path.
