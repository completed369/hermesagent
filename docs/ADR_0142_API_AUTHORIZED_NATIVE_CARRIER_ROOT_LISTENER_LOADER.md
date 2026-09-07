# ADR-0142: API authorized native carrier-root listener loader

Date: 2026-09-07

## Context

ADR-0141 can compose an already-authorized loaded `LISTENER` envelope into the strict native ABI and
the one-use Level-3 carrier-root service owner. The API also has an unactivated retained-descriptor
loader backed by audited PostgreSQL trust, but nothing joins an injected loader attempt to the new
listener composition. Loading before validating purpose, path, cancellation, or authority type
would consume one-use native authority for an invalid service.

## Decision

Add an unwired API-local async entry point that accepts an explicitly injected concrete one-use
loader. Before loading, it validates the exact Linux-x64 module request, exact carrier-root service
request, live abort signal, concrete Level-3 authority adapter, `LISTENER` module kind, carrier-root
service purpose, and equality of both socket paths. It calls the loader exactly once, rechecks
cancellation, and delegates the returned envelope to the ADR-0141 composition for independent
revalidation.

## Security and runtime-truth boundary

- Invalid loader types, requests, purposes, paths, authority types, and pre-load cancellation fail
  before loader consumption.
- The loader's own audited trust chain still authenticates the module and socket-directory evidence;
  this entry point cannot construct or bypass that chain.
- The returned loaded envelope is independently exact-validated before its strict native ABI is
  accepted.
- The entry point does not invoke the native listener, service authority, or service run and remains
  absent from the Nest application graph.
- Production supplies no loader, request, module path, socket path, principal mapping, shared mount,
  route, or application lifecycle.
- No deployment, publication, provider activation, spend, DNS change, commercial commitment, or
  Level-4 action occurs.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

The API now has an explicit fail-closed route from audited native module loading to an inert
carrier-root listener owner. Remaining work must compose the exact handler and live carrier binding
into a one-session run, then provide approved deployment-specific paths and principals plus bounded
application lifecycle wiring before producing authenticated runtime evidence.
