# ADR-0158: Authorized worker topology-carrier listener

Date: 2026-09-08

## Context

ADR-0155 could authenticate and reserve one API session accepted from an injected worker listener,
and ADR-0156 could transfer that opaque reservation into the canonical worker carrier owner.
Neither boundary owned listener creation or required a purpose-specific Level-3 service grant. A
generic listener grant would leave worker-carrier acceptance ambiguous with the existing recovery,
signing, topology-observation, and API root-lookup protocols.

## Decision

Add the distinct `TOPOLOGY_CARRIER_WORKER_LISTENER` one-session service purpose. Its grant requires
the `API_COORDINATOR` peer role introduced by ADR-0157. The service owner validates an exact live
carrier binding, requires its workspace and supervisor to match the grant, and accepts only a
nominal root-resolved worker constructed for that exact binding. It invokes the captured class
implementation rather than a replaceable instance method and constructs the bounded frame endpoint
itself.

The listener lifecycle creates one no-replacement Unix listener, attests the retained parent and
socket identities, and passes that exact owned listener into ADR-0155 admission. Admission checks
the socket identity again before and after acceptance and authenticates the API peer using
kernel-derived credentials. The admitted opaque reservation is claimed once, attached to the exact
worker endpoint, run for one bounded request/response, and closed before exact-identity listener
cleanup.

## Security and runtime-truth boundary

- The service grant is tenant-, supervisor-, path-, peer-role-, peer-credential-, deadline-, and
  purpose-bound. Protocol switching or a worker peer at the carrier listener is denied before
  listener creation.
- The live carrier binding is canonical, fresh, `NOT_CONFIGURED`, and must match the grant's
  workspace and supervisor before native activity.
- Listener identity is retained across creation, admission, and cleanup. A replaced socket or
  mismatched API credential closes the accepted session and removes only the originally owned
  listener.
- The service accepts only the canonical binding-authenticated root-resolved worker and the
  lifecycle accepts only the bounded endpoint created from it; neither can discover an observer,
  signer, key, module, path, identity, authority, or route.
- The owner remains one-attempt and cannot retry, multiplex, daemonize, or promote runtime truth.
- The composition remains outside `worker.ts`; no production listener authority, identity, path,
  signer custody, or lifecycle input is selected.
- No deployment, publication, provider activation, spend, DNS change, commercial commitment, or
  Level-4 action occurs.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

The full worker carrier exchange can now be executed through one exact Level-3-authorized and
kernel-authenticated listener when all dependencies are explicitly supplied. Remaining work must
join this owner to the existing retained-descriptor observer, authenticated root source, and
signer-loader composition without application activation, then select approved production
identities and custody before a real authenticated round trip can be claimed.
