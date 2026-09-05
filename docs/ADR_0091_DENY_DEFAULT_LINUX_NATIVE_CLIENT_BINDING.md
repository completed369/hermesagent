# ADR-0091: Deny-default Linux retained-native client binding ABI

Date: 2026-09-05

## Context

ADR-0085 owns and validates the worker-side Linux connection lifecycle, but its injected native
binding remains a structural TypeScript interface. Without a narrower boundary, a native module can
add exports, use accessors, replace validated methods after construction, expose an unordered handle,
or leave a newly allocated connection open when its handle shape is rejected.

## Decision

Add an exported but uncomposed production-facing adapter for one injected native client module:

1. the module has the exact own data-property ABI `{ abiVersion: 1, platform: 'LINUX',
lstatUnixSocket, connectUnixSocket }`; accessors, symbols, extra exports, alternate versions,
   alternate platforms, and the explicit deny module are rejected without invocation;
2. the returned connection has only the four own data-property methods `peerCredentials`,
   `writeAndShutdown`, `readToEof`, and `close`; validated module and connection functions are
   captured and bound at construction, preventing later property replacement from changing
   authority;
3. one adapter pins one validated absolute bounded `.sock` path and permits only initial lstat, one
   connect, and final lstat after the connection has completed peer, write/shutdown, and bounded
   read-to-EOF in that order;
4. requests are copied into adapter-owned memory and cleared after native write settles. Native
   response bytes are validated, copied, and cleared; the intermediate response copy is cleared after
   final lstat or close, after ADR-0085 has taken its own result copy;
5. cancellation and native failures deny with stable public codes and no native details. If
   cancellation wins connect, or the returned handle is malformed, the adapter closes the allocated
   connection before denial; and
6. the same malformed-allocation rule is added to the ADR-0089 listener adapter so a rejected native
   listener handle cannot strand its owned socket.

## Security and runtime-truth boundary

- The adapter loads no binary, performs no filesystem or network operation, discovers no path, and
  grants no listener, retry, loop, fallback, or process authority.
- It remains absent from the API and worker compositions. The exported deny module continues to
  represent missing native support.
- No authorization provisioning, key custody, provider, deployment, publication, spending, or
  Level-4 action is included.
- Fake-handle tests are ABI and state-machine evidence, not runtime-connectivity evidence. Codex,
  Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

The worker-side native module now has an exact, captured, cleanup-safe ABI matching the listener-side
boundary. The next safe slice is the source-only asynchronous Linux N-API client implementation and
kernel build evidence behind this ABI, still unloaded, pathless, and uncomposed.
