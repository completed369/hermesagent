# ADR-0111: Immutable native-module image artifacts

Date: 2026-09-06

## Context

ADRs 0090 and 0092 provide reviewed Linux-x64 N-API listener and client sources, while ADR-0110
joins audited durable authorization to the retained-descriptor loader. No final image contains the
native artifacts, so a later path-provisioning and service-ownership boundary has no reviewed
source-to-image input.

## Decision

Compile both existing C sources in a dedicated image build stage with warnings as errors, fortified
libc calls, stack protection, immediate/full relocation binding, and no linker build ID. Install
only the listener artifact in the API image and only the client artifact in the worker image at
fixed `/usr/lib/ventureos/native` paths. Both files are root-owned, non-writable mode `0444`.

The local-only runtime-substrate workflow must export every final image and prove the exact artifact
allowlist, ownership, mode, and ELF magic. The tools, web, and ingress images must contain no native
artifact directory. Existing vulnerability, KEV, secret, rootfs, and SBOM gates remain mandatory.

## Security and runtime-truth boundary

- The package runtime allowlist remains `dist` only; no `.node` file is committed or published as a
  package artifact.
- Neither image command references a native artifact. There is no loader call, path-provisioner
  call, socket path, service owner, retry loop, route, worker composition, key/root, or signer.
- Root-owned read-only image artifacts are inputs only. They grant no authorization and cannot be
  overwritten by the non-root application principals.
- Image builds and security scans are local to CI. This change performs no publication, deployment,
  provider activation, spend, DNS change, commercial commitment, or Level-4 action.
- `runtimeConnection`, Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

The reviewed native implementations become immutable, scan-covered inputs in only the images that
need them. Explicit authorization, identity-preserving runtime provisioning, bounded service
ownership, and complete authenticated round-trip evidence remain required before activation or any
runtime-truth promotion.
