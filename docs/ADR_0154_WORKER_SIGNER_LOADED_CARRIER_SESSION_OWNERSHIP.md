# ADR-0154: Worker signer-loaded carrier-session ownership

Date: 2026-09-07

## Context

ADR-0151 consumes an exact abortable CLIENT module-load request for the carrier signer, while
ADR-0153 composes an already-loaded signer endpoint with one accepted carrier byte session. Joining
those factories directly would allow an invalid accepted session to be discovered only after native
module loading, and a failed or cancelled load could abandon a valid accepted session without
bounded cleanup.

## Decision

Add an exact accepted-session reservation in Agent Bridge. It validates the timeout before touching
untrusted session accessors, captures the three byte-session methods, transfers them exactly once to
the canonical ADR-0152 owner, and can close an unclaimed session exactly once within the same
deadline.

Add an unwired worker factory that reserves the accepted session before delegating to ADR-0151. A
successful signer load transfers the reserved session to the canonical one-use owner. Any loader,
cancellation, output-authentication, or endpoint-composition failure performs bounded cleanup,
preserves typed local-IPC failures, and redacts other implementation errors as `EXCHANGE_DENIED`.

## Security and runtime-truth boundary

- Invalid accepted-session shape or timeout is denied before the signer loader is consumed.
- Successful construction performs no carrier read, write, frame handling, root lookup,
  observation, signing, filesystem access, IPC exchange, or native client call.
- Failure cleanup can only close the exact prebound accepted session; it cannot read, write, retry,
  attach a different endpoint, or leak an underlying loader error.
- The factory remains absent from `worker.ts` and selects no loader, module/socket path, production
  identity, route, key material, custody service, listener, or service authority.
- Listener acceptance and peer authentication remain external prerequisites. This reservation is
  structural ownership, not runtime-authentication evidence.
- No deployment, publication, provider activation, spend, DNS change, commercial commitment, or
  Level-4 action occurs.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

The worker can now move from one explicitly accepted session and one exact signer-loader request to
the canonical carrier owner without validation-order or cleanup gaps. Remaining work must define
the independently authenticated carrier listener/transport service and establish signer custody and
approved production identities before any runtime connection can be claimed.
