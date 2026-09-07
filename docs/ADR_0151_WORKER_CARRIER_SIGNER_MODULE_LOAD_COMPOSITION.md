# ADR-0151: Worker carrier-signer module-load composition

Date: 2026-09-07

## Context

ADR-0150 binds an already-loaded native CLIENT module to the authenticated worker carrier signer,
but leaves the loader operation external. The next boundary must constrain that operation to an
exact signer socket and abort lifecycle without discovering or selecting production authority.

## Decision

Add an explicit unwired async worker factory that requires the exact bounded module loader,
non-aborted signal, concrete carrier-root source, validated CLIENT load request, and exact signing
authorization. The request and authorization socket paths must match before the loader is consumed.
After one load, cancellation is checked again and the loaded result is delegated to ADR-0150.

## Security and runtime-truth boundary

- Substituted loaders, sources, roles, requests, socket paths, authorities, and pre/post-load
  cancellation fail closed.
- Loader output is reauthenticated by ADR-0150 before entering the strict native binding.
- No loader, module path, socket identity, principal mapping, key material, custody service, carrier
  listener, or service lifecycle is discovered or selected.
- The factory remains absent from `worker.ts` and performs no root lookup, observation, signing,
  frame handling, or IPC exchange during composition.
- No deployment, publication, provider activation, spend, DNS change, commercial commitment, or
  Level-4 action occurs.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

The reviewed worker carrier path can now consume one independently authorized and abortable signer
CLIENT module load without exposing loader, request, client, or transport substitution. Remaining
work must establish approved production identities plus signer-custody and carrier-listener service
lifecycles, then produce a verified authenticated runtime round trip before any connection claim.
