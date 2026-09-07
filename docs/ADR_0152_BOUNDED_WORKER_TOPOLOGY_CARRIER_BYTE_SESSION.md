# ADR-0152: Bounded worker topology-carrier byte session

Date: 2026-09-07

## Context

The worker topology-carrier frame endpoint validates and handles one canonical byte frame, but no
boundary owns an already-accepted byte session through bounded read, response write, and close. A
future listener composition must not be able to omit cleanup, retry the endpoint, or bypass the
canonical frame limit.

## Decision

Add a one-use worker carrier session owner around the exact concrete frame endpoint and an injected
already-accepted byte-session port. It:

1. captures the session's read, write-and-shutdown, and close methods at construction;
2. reads at most the canonical 64 KiB carrier frame limit under cancellation and deadline;
3. passes the result only to the exact one-use worker frame endpoint;
4. writes only the endpoint's canonical response under cancellation and deadline;
5. closes exactly once on success, malformed input, handler failure, cancellation, timeout, or
   write failure; and
6. rejects concurrent or sequential reuse and bounds an uncooperative close.

## Security and runtime-truth boundary

- The session is already accepted. This owner cannot discover, create, bind, accept, authenticate,
  retry, multiplex, or expose a listener or byte channel.
- The exact frame endpoint retains mutual carrier authentication, binding, signed delivery,
  opposite-root resolution, retained-descriptor observation, and keyless signer constraints.
- No transport implementation, listener identity, route, module, socket, key material, custody
  service, principal mapping, or lifecycle authority is selected.
- The owner remains absent from `worker.ts` and changes no runtime status.
- No deployment, publication, provider activation, spend, DNS change, commercial commitment, or
  Level-4 action occurs.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

The worker carrier path now has explicit one-use ownership once a separately authenticated listener
hands it an accepted byte session. Remaining work must define and compose that authenticated
listener/transport boundary and separately establish signer custody and approved production
identities before a verified runtime round trip can be claimed.
