# ADR-0126: Topology carrier public-root registry

Date: 2026-09-06

## Context

ADR-0125 authenticates carrier deliveries with public Ed25519 roots, but deliberately left those
roots unprovisioned. A future composition must not accept a general key or a transport assertion as
authority. Each ADR-0125 root is a narrow grant for one canonical, maximum-five-second carrier
binding, one role, and one principal.

## Decision

Add an uncomposed PostgreSQL registry for public-only topology carrier signature roots. Admission
requires an exact workspace-bound Level-3 control-plane capability, a currently live canonical
carrier binding, and a non-revoked version-1 root whose workspace, supervisor, binding hash,
principal role, principal reference, and validity coverage exactly match that binding.

The binding scope, public root, and authorization evidence are inserted atomically. The database
binds a carrier identifier to one tenant, supervisor, canonical binding, plan, attempt, principal
pair, and five-second window. It admits at most the two expected role roots, rejects signer or key
reuse between those roles, requires current Level-3 evidence through a deferred constraint, and
denies every update or delete. Exact concurrent requests converge through authenticated replay;
conflicting state denies. Reads require the complete live binding and role, return no more than one
matching root, and fail closed on ambiguity.

## Security and runtime-truth boundary

- The registry stores public SPKI material only. It has no private-key custody or signing method.
- It neither creates a carrier binding nor extends its lifetime; expired bindings cannot be
  provisioned or read.
- The registry is absent from API and worker composition. No root is seeded or provisioned.
- No carrier, network route, TLS identity, Temporal setting, shared mount, provider, deployment,
  publication, spend, DNS change, or Level-4 action is introduced.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

A later reviewed composition can resolve the exact public verification grant without trusting
configuration text or transport metadata. It must still supply independently authorized roots,
keyless signers, a bounded carrier implementation, role-local wiring, and infrastructure review.
