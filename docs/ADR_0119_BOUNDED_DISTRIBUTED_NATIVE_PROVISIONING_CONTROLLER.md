# ADR-0119: Bounded distributed native provisioning controller

Date: 2026-09-06

## Context

ADR-0118 supplies an isolated attempt root and commits its provenance into the downstream
parent-directory grant. The remaining provisioning steps must happen in a strict evidence chain:
runtime root, fixed parent hierarchy, worker-side CLIENT artifact, and API-side LISTENER artifact.
The artifacts exist in different images, so joining their concrete hosts in one process would encode
a topology that the deployment does not have. Returning partial success would also invite callers to
treat an unusable attempt as provisioned.

## Decision

Add an exported one-attempt controller with four separately injected provisioning ports. It validates
the complete immutable plan before the first port call, then derives every downstream request only
from the immediately preceding attestation. It revalidates exact result shape, request hash, tenant,
supervisor, attempt, retained identities, ownership, modes, source digest and size, socket path,
Level-3 approval evidence, five-minute maximum freshness, and `NOT_CONFIGURED` truth after each
boundary.

The sequence is fixed: runtime root, parent directories, CLIENT, LISTENER. Cancellation is checked
between boundaries. A failed or cancelled operation consumes the controller; retry requires a new
controller and fresh attempt root. No partial bundle is returned. Only after all four attestations
match, including the shared socket-directory identity and parent provisioning ID, does the controller
return frozen `PROVISIONED_NOT_ACTIVATED` evidence.

The ports deliberately carry no transport implementation. This permits a future reviewed deployment
adapter to place each operation beside its real artifact without pretending the API and worker images
share a process.

## Security and runtime-truth boundary

- Every port denies by default; constructing the controller with any deny port is rejected.
- Unknown fields, accessors, invalid paths, writable source modes, zero identities, oversized
  artifacts, stale evidence, drift, cancellation, and replay deny before downstream effects.
- The controller has no cleanup authority. A partial failed attempt remains isolated under its unique
  root for later separately authorized lifecycle handling.
- No mount, writable parent, queue, RPC, route, scheduler, service loop, module load, key, signer,
  provider, status transition, or positive runtime transport is added.
- Level 4 and runtime-principal authority remain outside the boundary. Each injected provisioner keeps
  its existing exact Level-3 authorization enforcement.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

VentureOS now has a topology-neutral, fail-closed operation that can coordinate the complete native
filesystem evidence chain without returning partial success or inventing connectivity. A later change
must define authenticated bounded transports for the four ports and prove the writable-parent/shared-
mount deployment topology before composing this controller. Provisioning alone still cannot activate
the supervisor or promote runtime truth.
