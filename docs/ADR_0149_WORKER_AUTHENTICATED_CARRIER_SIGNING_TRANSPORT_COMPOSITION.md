# ADR-0149: Worker authenticated carrier-signing transport composition

Date: 2026-09-07

## Context

ADR-0148 provides a topology-carrier-specific authenticated Linux local signing transport, while
ADR-0147's worker factory still accepts an arbitrary signing transport. The next worker boundary
must fix the transport implementation and its underlying client provenance without selecting a
production socket identity, loading native code, or granting signing custody.

## Decision

Add an explicit unwired worker factory that requires the exact concrete worker carrier-root source
and an exact `BoundedLinuxRetainedNativeSupervisorLocalIpcClient`. It constructs the ADR-0148
authenticated signing transport from that client and an injected exact local IPC authorization,
then supplies it to the retained-descriptor, worker-role keyless, framed composition from ADR-0147.

Construction validates dependencies but performs no root lookup, signing, close, observation,
frame handling, IPC exchange, filesystem access, socket connection, or native call.

## Security and runtime-truth boundary

- Substituted root sources or signing clients fail before signing authority is used.
- Signing authority remains exact, requires mode `0600`, fixed endpoint identity and peer
  credentials, and `runtimeConnection: NOT_CONFIGURED`.
- The caller cannot substitute the transport implementation or its carrier-specific limits.
- The bounded client still requires a separately reviewed native binding; this factory neither loads
  one nor selects a socket path, identity, key material, custody service, listener, or lifecycle.
- The factory remains absent from `worker.ts`; off Linux/x64 the retained-descriptor observer denies
  `NOT_CONFIGURED` without native activity.
- No deployment, publication, provider activation, spend, DNS change, commercial commitment, or
  Level-4 action occurs.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

The reviewed worker carrier path now fixes root provenance, retained-descriptor observation,
worker-role keyless signing, authenticated signing transport, exact bounded-client provenance, and
canonical framing. Remaining work must bind an approved loaded native client module to the signer
authorization, establish custody/service and carrier listener lifecycles, and produce a verified
authenticated runtime round trip before any connection claim.
