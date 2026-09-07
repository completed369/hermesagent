# ADR-0141: API loaded native carrier-root listener composition

Date: 2026-09-07

## Context

ADR-0140 gives carrier-root lookup a distinct Level-3 one-session service purpose and owned Linux
listener lifecycle. The API still has no bridge from an authorized loaded `LISTENER` module to that
service owner. Allowing a generic module envelope, service purpose, socket path, or service
authority through this seam would erase authorization domains before any listener was created.

## Decision

Add an API-local inert factory that accepts one exact already-loaded `LISTENER` envelope, one
concrete `BoundedLevel3RetainedNativeSupervisorServiceAuthority`, and one exact carrier-root service
request. It rejects accessor, symbol, extra-field, module-kind, runtime-state, service-purpose, and
socket-path drift. Only then does it wrap the native module in the strict one-use listener ABI and
return a one-use retained-native service owner.

Construction does not invoke the native module or service authority. The service authority still
independently exact-matches the request when the owner is eventually run, while the service owner
independently verifies the returned grant and live carrier scope.

## Security and runtime-truth boundary

- Only the root-lookup listener purpose can enter this composition.
- The module authorization socket path must equal the Level-3 service request socket path.
- Only the concrete API Level-3 authority adapter is accepted; a structural authority spoof is
  rejected.
- The exact loaded envelope is copied from data descriptors and must retain
  `runtimeConnection: NOT_CONFIGURED`.
- The factory selects no path, module, listener, peer, carrier, database, route, mount, or service
  lifecycle and is absent from the Nest application graph.
- No deployment, publication, provider activation, spend, DNS change, commercial commitment, or
  Level-4 action occurs.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

An approved listener module can now reach the existing one-session ownership boundary without
weakening module, path, purpose, or Level-3 authority scope. Remaining work must explicitly consume
an injected authorized loader, compose the handler and carrier binding into one service run, provide
approved shared path and Linux principals, wire a bounded application lifecycle, and produce a
verified authenticated round trip before any runtime can be reported connected.
