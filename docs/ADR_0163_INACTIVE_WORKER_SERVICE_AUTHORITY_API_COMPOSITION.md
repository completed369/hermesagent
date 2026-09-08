# ADR-0163: Inactive worker service-authority API composition

Date: 2026-09-08

## Context

ADR-0161 defined the signed one-shot worker grant protocol and ADR-0162 gave it a distinct
kernel-authenticated API listener purpose. The parts were deliberately uncomposed: no boundary joined
the native listener, listener authority, durable worker verification root, API signer, and exact
worker-listener grant issuer.

## Decision

Add an API-local composition module that can:

- validate an already-loaded native `LISTENER` envelope and bind it to only the distinct
  `TOPOLOGY_CARRIER_WORKER_SERVICE_AUTHORITY_API_LISTENER` Level-3 authority;
- consume one explicitly injected native module loader only after its socket and purpose match;
- at a one-shot run boundary, validate both listener and worker service requests against the same
  live carrier binding, resolve only the worker public root from the durable registry, construct the
  ADR-0161 coordinator handler with the exact worker-listener issuer, authenticate the request and
  sign the response through the API signer, and frame it through the ADR-0162 service owner.

The module is not imported by the Nest module or any startup entry point.

## Security and runtime-truth boundary

- The API listener and worker listener retain distinct requests, peer roles, socket paths, grants,
  request hashes, approval evidence, and service-run identities.
- Workspace and supervisor scope for both requests must equal the fresh carrier binding before the
  durable worker root is queried or the listener owner is consumed.
- The worker root must be the exact current, unrevoked `WORKER_CLIENT` root for the live binding.
- The API signer and exact Level-3 worker-listener issuer remain injected; no ambient key, secret,
  authority, path, module, process, or route is discovered.
- Construction and loading do not create a listener. A run is single-frame and inherits the bounded
  kernel peer admission, hidden endpoint authenticity, timeout, cleanup, and unlink guarantees.
- No provider activation, deployment, publication, spend, DNS change, commercial commitment, or
  Level-4 action occurs.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

The API side of worker service-authority delivery can now be assembled without activating it.
Remaining work is the matching authenticated worker native client/authority composition, followed by
explicitly approved production identities, paths, signer custody, and launch inputs.
