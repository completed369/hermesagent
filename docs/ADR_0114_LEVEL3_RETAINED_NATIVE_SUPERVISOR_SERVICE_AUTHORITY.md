# ADR-0114: Level-3 retained-native supervisor service authority

Date: 2026-09-06

## Context

ADR-0113 adds a bounded one-session service owner whose positive authority deliberately denies by
default. Without a reviewed adapter, a future caller could either remain permanently denied or
invent a grant from caller-controlled metadata. The service grant must be derived from the existing
unforgeable control-plane capability boundary without acquiring path, listener, signer, worker, or
runtime authority.

## Decision

Add an API-side one-use authority adapter that:

1. accepts only an unforgeable `CONTROL_PLANE` capability bound to an exact workspace and principal,
   a non-runtime actor, and exactly Level 3; Level 4 and `AI_COO` capabilities are rejected;
2. freezes one exact expected ADR-0113 request, requires its workspace to match the trusted context,
   and rejects any tenant, supervisor, recovery-or-signing purpose, path evidence, directory/socket,
   worker principal, or deadline drift;
3. rejects malformed, accessor-bearing, extra-field, private/sensitive reference, and invalid-clock
   inputs before emitting authority;
4. consumes its first attempted authorization, preventing retry after malformed or drifted input;
   and
5. emits one frozen one-minute grant whose service-run identifier, approval identifier, and approval
   evidence are domain-separated digests of the complete request, principal, actor kind, policy
   version, authority level, and validity window.

Also harden the shared ADR-0113 validator so secret-, credential-, token-, prompt-, transcript-, and
private-reasoning-labelled references are denied before any authority adapter sees them.

## Security and runtime-truth boundary

- The capability proves authorization source and level; it does not select the request. The adapter
  accepts only the exact request fixed at construction and gives the service owner no alternate
  positive authority path.
- The grant contains identifiers and SHA-256 evidence only. No credential, secret, key, root,
  signature, module byte, payload, prompt, transcript, or private reasoning is accepted or emitted.
- The adapter is absent from the Nest graph, routes, workers, schedulers, CLIs, image commands, and
  deployment configuration. Constructing or invoking it performs no filesystem, module-loader,
  socket, process, network, signer, or runtime action.
- No deployment, publication, spend, DNS change, commercial commitment, or Level-4 action occurs.
  Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

The bounded owner now has a reviewed non-Founder-gated authority source available for future
explicit composition without weakening tenant, purpose, peer, path-evidence, approval, or deadline
binding. Parent runtime directories, actual path/loader/service composition, signer/root custody,
worker wiring, and a complete authenticated registration-through-result round trip remain required
before runtime connectivity can be claimed.
