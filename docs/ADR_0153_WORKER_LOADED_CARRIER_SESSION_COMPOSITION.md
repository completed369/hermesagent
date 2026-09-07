# ADR-0153: Worker loaded carrier-session composition

Date: 2026-09-07

## Context

ADR-0150 constructs the authenticated loaded-signer worker frame endpoint, and ADR-0152 owns one
already-accepted worker carrier byte session. The worker composition still leaves those exact
boundaries separate, allowing a caller to substitute session ownership or omit it.

## Decision

Add an explicit unwired worker factory that constructs the ADR-0150 endpoint and immediately wraps
it in the exact ADR-0152 one-use session owner. The accepted byte-session port and all timeouts are
explicit inputs.

Construction performs no module load, native call, filesystem access, IPC exchange, carrier read or
write, close, frame handling, root lookup, observation, or signing.

## Security and runtime-truth boundary

- Loaded module and signer authorization authentication, exact socket matching, strict native ABI,
  retained-descriptor observer, worker-role keyless signer, mutual carrier authentication, and
  canonical framing remain fixed by the existing composition.
- The accepted session cannot substitute the frame endpoint or its one-use ownership behavior.
- The factory accepts an already-accepted session. It cannot discover, create, bind, authenticate,
  accept, retry, multiplex, or expose a listener or transport.
- The factory remains absent from `worker.ts` and selects no loader, production path/identity,
  route, key material, custody service, listener, lifecycle, or runtime connection.
- No deployment, publication, provider activation, spend, DNS change, commercial commitment, or
  Level-4 action occurs.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

The worker can now compose an authenticated loaded signer endpoint with exact one-use ownership of
an already-accepted carrier byte session. Remaining work must bind the abortable signer loader into
this session composition and define a separately authenticated carrier listener/transport service,
then establish signer custody and approved production identities before any runtime claim.
