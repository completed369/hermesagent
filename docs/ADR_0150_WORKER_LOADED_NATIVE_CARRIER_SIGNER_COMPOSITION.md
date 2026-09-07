# ADR-0150: Worker loaded native carrier-signer composition

Date: 2026-09-07

## Context

ADR-0149 fixes the worker carrier signing transport and requires an exact bounded Linux local
client, but leaves the native client binding external. The next boundary must authenticate an
already-loaded CLIENT module and bind its authorized socket to that transport without choosing or
loading production code.

## Decision

Add an explicit unwired worker factory that authenticates the exact loaded CLIENT module envelope
and exact local IPC authorization, requires their socket paths to match, constructs the strict
native ABI binding and bounded closable client, and delegates to the ADR-0149 worker composition.

Construction performs no module load, filesystem access, socket connection, IPC exchange, root
lookup, observation, signing, close, or frame handling.

## Security and runtime-truth boundary

- The loaded envelope must have only the canonical fields, data properties, module kind `CLIENT`,
  schema version 1, and `runtimeConnection: NOT_CONFIGURED`.
- The authorization remains exact and kernel-attested; a substituted socket path or authority is
  denied before native activity.
- The native module must satisfy the strict client ABI before it can enter the bounded client.
- The factory remains absent from `worker.ts`; it does not select a module loader, approved module
  path, signer socket identity, key material, custody service, carrier listener, or lifecycle.
- Off Linux/x64, the retained-descriptor composition remains `NOT_CONFIGURED` without native calls.
- No deployment, publication, provider activation, spend, DNS change, commercial commitment, or
  Level-4 action occurs.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

The reviewed worker carrier path can now bind an independently loaded, authenticated native CLIENT
module to the signer transport without exposing client or transport substitution. Remaining work
must compose an approved abortable module-load request, establish custody/service and carrier
listener lifecycles, and produce a verified authenticated runtime round trip before any connection
claim.
