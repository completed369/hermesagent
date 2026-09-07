# ADR-0147: Worker retained-descriptor observer composition

Date: 2026-09-07

## Context

ADR-0146 fixes worker delivery signing to the bounded keyless `WORKER_CLIENT` signer but still
accepts an arbitrary observation port. The retained-descriptor Linux observer already provides the
required effective-identity, `O_NOFOLLOW`, retained-descriptor, hash, metadata recheck, and
no-content-release evidence, but no worker composition fixes its observer role or provenance.

## Decision

Add an explicit unwired worker-local factory that first requires the concrete mutually
authenticated coordinator-root source, constructs the retained-descriptor observer with role fixed
to `WORKER_CLIENT` and the injected clock, then supplies it to the ADR-0146 keyless framed worker.

Observer construction is Linux/x64-only and performs no filesystem operation. Files are opened and
read only if the resulting one-use frame later passes root resolution and carrier authentication and
reaches the observer with an exact validated request.

## Security and runtime-truth boundary

- A substituted root source fails before observer construction or signing-transport inspection.
- The caller cannot substitute the observer role or implementation on this composition path.
- The retained-descriptor observer preserves effective UID/GID checks, no-follow descriptor opens,
  exact metadata and digest validation, rechecks after hashing, and zeroes read buffers.
- No source/runtime path, signing transport implementation, private key/custody, byte channel,
  listener, loader, principal mapping, mount, route, or application lifecycle is selected.
- The factory remains absent from `worker.ts`; off Linux/x64 it denies `NOT_CONFIGURED`.
- No deployment, publication, provider activation, spend, DNS change, commercial commitment, or
  Level-4 action occurs.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

The reviewed worker carrier path now fixes root provenance, retained-descriptor observation,
keyless worker-role signing, and canonical bounded framing in one explicit composition. Remaining
work must provide reviewed signer transport/custody and authenticated byte-channel listener
lifecycles using approved deployment-specific identities and paths, then produce verified
round-trip evidence before any runtime can be reported connected.
