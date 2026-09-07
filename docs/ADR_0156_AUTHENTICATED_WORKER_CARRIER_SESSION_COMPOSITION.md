# ADR-0156: Authenticated worker carrier-session composition

Date: 2026-09-07

## Context

ADR-0155 authenticates one accepted carrier session against the exact retained listener identity and
API peer credentials, then returns the ADR-0154 accepted-session reservation. The worker signer
composition still accepted only a raw byte session, so the authenticated reservation could not be
transferred directly without exposing or reconstructing its captured session methods.

## Decision

Have admission mint an unforgeable, one-use wrapper around the canonical accepted-session
reservation. Add an unwired worker factory that accepts only that admission-minted wrapper, claims
its opaque reservation before signer loading, and transfers it directly into the existing
signer-loaded one-use carrier owner. A substituted wrapper is denied before the signer loader is
consumed. Loader, cancellation, and endpoint-composition failures close the exact reservation
through its existing bounded cleanup and preserve typed local-IPC denials while redacting other
implementation errors.

The earlier raw-session factory now creates its reservation first and delegates to the same
composition, leaving one ownership and cleanup path.

## Security and runtime-truth boundary

- A substituted structural object or directly constructed generic reservation is denied before
  signer loading or native activity.
- The reservation remains opaque: the factory cannot recover, replace, or rebind its captured byte
  session.
- Successful construction performs no carrier read, write, frame handling, root lookup,
  observation, signing, filesystem access, IPC exchange, or native client call.
- The factory remains outside `worker.ts` and selects no admission binding, listener, service
  authority, loader, module/socket path, production identity, route, or signing custody.
- No deployment, publication, provider activation, spend, DNS change, commercial commitment, or
  Level-4 action occurs.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

The exact reservation produced by authenticated worker admission can now feed the signer-loaded
carrier-session owner without breaking session opacity or duplicating ownership. Remaining work
must compose exact service authorization and listener ownership with admission, then establish
approved production identities and signer custody before runtime activation or an authenticated
round trip can be claimed.
