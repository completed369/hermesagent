# ADR-0155: Authenticated worker topology-carrier session admission

Date: 2026-09-07

## Context

ADR-0154 can reserve and safely transfer one already-accepted worker carrier byte session before
loading its signer. Acceptance and peer authentication were still an external assertion: nothing
bound that session to the expected retained Unix-socket identity or the connecting API principal.

## Decision

Add a one-use Linux admission boundary around an injected, already-created listener binding. It
authenticates an exact `NOT_CONFIGURED` local-IPC authorization before native access, observes the
listener with `lstat(2)` before and after acceptance, derives the connected principal from
`SO_PEERCRED`, and transfers the accepted byte session only when every value exactly matches.

The admission captures the native binding and accepted-session methods, rejects concurrent or
repeated acceptance, and closes a denied accepted session within the configured deadline. Typed
local-IPC denials are preserved; other native and cleanup failures are redacted as
`EXCHANGE_DENIED`.

## Security and runtime-truth boundary

- Caller metadata cannot stand in for kernel evidence: listener device, inode, owner, mode, and API
  peer PID/UID/GID must be returned by the injected native boundary and exactly match authorization.
- Listener replacement between the two retained identity observations is denied before transfer.
- Admission performs no byte read, response write, frame handling, root lookup, observation,
  signing, module load, retry, or loop.
- The boundary accepts only from an injected existing listener. It cannot create, discover,
  replace, expose, close, or unlink the listener itself.
- No production path or principal is selected, no service authority issues authorization, and the
  boundary remains absent from `worker.ts`.
- No deployment, publication, provider activation, spend, DNS change, commercial commitment, or
  Level-4 action occurs.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

The worker carrier path now has a concrete independently authenticated accepted-session boundary
that can feed the ADR-0154 ownership composition. Remaining work must compose exact service
authorization and listener ownership with this admission, then establish signer custody and
approved production identities before a verified authenticated round trip can be claimed.
