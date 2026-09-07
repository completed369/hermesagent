# ADR-0138: Inert worker composition for an already-loaded Linux native client

Date: 2026-09-07

## Context

ADR-0137 joins an explicitly injected closable Linux IPC client to the worker's authenticated
carrier-root lookup source. The retained-descriptor loader and strict Linux native client ABI
adapter already exist independently, but the worker has no reviewable seam that preserves the
loader's exact `CLIENT` module and socket-path binding while constructing the ADR-0137 client.

## Decision

Extend the worker-local factory with an entry point that accepts one exact already-loaded `CLIENT`
module envelope. It rejects non-plain or accessor-bearing envelopes, unexpected fields, listener
modules, configured runtime truth, malformed local IPC authorization, and any difference between
the loader-authorized socket path and the kernel-authenticated local IPC authorization.

After validation, construction wraps the injected native module in the strict one-use Linux ABI
binding, wraps that binding in the closable Linux IPC client, and delegates to the ADR-0137 factory.
Construction does not call the loader, native module, or IPC client.

## Security and runtime-truth boundary

- No path is selected, no module is loaded, and no filesystem, native, or socket operation occurs.
- The loaded envelope must be `CLIENT`, exact-shaped, and remain `NOT_CONFIGURED`.
- Socket-path substitution is rejected before native or IPC activity.
- The factory remains absent from `worker.ts` and all activity/workflow graphs.
- No shared mount, route, listener, service lifecycle, key, signer, provider, deployment,
  publication, spend, commercial commitment, or Level-4 action is introduced.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

The worker now has an inert ownership-preserving construction seam from a separately authorized,
already-loaded client module to its one-use coordinator-root source. A later composition must still
obtain explicit loader authority, invoke the loader, derive exact local IPC authorization from
approved provisioning and OS-principal evidence, and own the service lifecycle. The shared mount,
route, API listener, carrier signing path, application wiring, and verified runtime round trip also
remain absent.
