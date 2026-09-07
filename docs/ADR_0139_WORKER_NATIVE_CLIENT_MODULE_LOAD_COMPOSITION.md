# ADR-0139: Unwired worker native client module-load composition

Date: 2026-09-07

## Context

ADR-0138 creates an inert worker carrier-root source from an already-loaded native `CLIENT` module.
The retained-descriptor loader separately enforces a one-attempt, short-lived authorization bound to
an exact module identity, digest, immutable path, socket directory, role, and `NOT_CONFIGURED`
runtime truth. The worker still lacked a narrow boundary that safely joins those two components.

## Decision

Add an asynchronous worker-local entry point that accepts an explicitly injected one-use loader,
one load request, an abort signal, the carrier binding, and local IPC authorization. Before
consuming the loader it independently validates and snapshots the request and authorization,
requires the `CLIENT` role, and requires exact socket-path equality. After loading it rejects
cancellation and delegates the returned envelope to ADR-0138, which revalidates its exact shape,
role, runtime truth, native ABI, and socket binding.

The entry point remains absent from `worker.ts` and every activity and workflow graph. Production
supplies no loader instance, authorization source, module request, module path, socket path, or
lifecycle owner.

## Security and runtime-truth boundary

- Invalid role, request, socket binding, or pre-load cancellation fails before loader consumption.
- Post-load cancellation and loader-output substitution fail before any loaded-module ABI or IPC
  activity.
- Loader authorization retains its existing exact path, digest, descriptor, owner, mode, expiry,
  one-use, and `NOT_CONFIGURED` constraints.
- This change performs no production load, exchange, connection, database read, discovery, or
  application wiring and adds no route, mount, listener, signer, key, provider, or service owner.
- No deployment, publication, provider activation, spend, DNS change, commercial commitment, or
  Level-4 action occurs.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

The reviewed worker boundary can now carry a separately authorized native `CLIENT` module load into
the inert carrier-root source without weakening role or socket ownership. Remaining work must still
supply a positive authorization chain in the worker's trust domain, approved module and socket
paths, shared runtime mount, API listener ownership, route and signer lifecycle, application
composition, and a verified authenticated round trip.
