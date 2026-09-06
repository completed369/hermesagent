# ADR-0112: Tenant-bound Level-3 native path provisioning

Date: 2026-09-06

## Context

ADR-0096 supplied a one-attempt identity-preserving Linux-x64 path provisioner, and ADR-0111 put
immutable root-owned native inputs in the API and worker images. The provision request and returned
attestation did not carry workspace or supervisor scope, however, so a valid filesystem attestation
could be transposed into a differently scoped ADR-0098 snapshot request. The provisioner's positive
authority port also had no reviewed non-Founder-gated implementation or explicit approval evidence.

## Decision

Strengthen the path-provision contract and add an API-side authority adapter:

1. every request, grant, and returned attestation now exact-binds the path-provision purpose,
   workspace, and supervisor instance in addition to the existing source identity, digest, paths,
   owner, platform, architecture, and `NOT_CONFIGURED` truth;
2. a one-use authority accepts only an exact trusted `CONTROL_PLANE` capability at Level 3 for a
   non-runtime principal in the same workspace;
3. the authority freezes one exact expected request, rejects drift and Level 4, and emits a
   one-minute request-hash-bound grant whose identifier and approval evidence are domain-separated
   digests of the complete scope, request, principal, actor kind, policy version, and time window;
4. the provisioner validates and carries the exact approval identifiers, digest, principal,
   authority level, and window into its frozen path attestation; and
5. the ADR-0098 snapshot controller rejects any path attestation whose workspace or supervisor
   differs from the enclosing issuance request before consulting issuance authority or a signer.

## Security and runtime-truth boundary

- The authority selects no source, target, socket, owner, tenant, or supervisor. All are exact
  caller-supplied fields fixed at construction and independently revalidated by the provisioner.
- Path provisioning remains fail-if-present, owner-only, retained-descriptor, and one-attempt. The
  immutable image input is never overwritten and the future socket must remain absent.
- The adapter is absent from the Nest graph, routes, workers, schedulers, image commands, and
  deployment configuration. No filesystem operation occurs merely by constructing it.
- No module is loaded, socket opened, service started, key/root provisioned, signer contacted,
  provider activated, deployment or publication performed, money spent, DNS changed, commercial
  commitment made, or Level-4 boundary crossed.
- `runtimeConnection`, Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

An explicitly approved path attestation can no longer cross tenant or supervisor scope unnoticed,
and its bounded Level-3 evidence survives into the later signed authorization snapshot. The parent
runtime directories, positive composition call, snapshot signer/root, bounded service owner, and
complete authenticated runtime round trip remain separate unfinished work.
