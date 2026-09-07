# ADR-0148: Authenticated local topology-carrier signing transport

Date: 2026-09-07

## Context

ADR-0146 binds worker carrier delivery signing to the bounded keyless signer, but its byte transport
remains unconfigured. ADR-0103 already authenticates one local signing exchange with exact Linux
socket identity and `SO_PEERCRED` evidence. The topology-carrier signing protocol has distinct 72
KiB request and 2 KiB response ceilings, so the module-authorization adapter cannot be substituted
without incorrectly narrowing or conflating the two protocols.

## Decision

Factor the shared one-use authenticated Linux local signing exchange into an internal bounded
transport and expose a topology-carrier-specific adapter. Both public adapters fix their own
protocol limits while sharing the exact authorization, endpoint, peer, state, close, defensive-copy,
and error-redaction behavior.

The new adapter accepts only an injected closable local IPC client and exact authorization. It does
not discover a socket, select a signer, own key material, create a listener, or initiate an exchange
at construction.

## Security and runtime-truth boundary

- Authorization remains exact and `runtimeConnection` must be `NOT_CONFIGURED`.
- Every exchange requires an exact `Uint8Array`, is one-use, and validates before/after socket
  device, inode, owner, group, mode, and path plus exact peer PID, UID, and GID.
- Carrier request and response limits are fixed internally to 72 KiB and 2 KiB; callers cannot alter
  them.
- The client is explicitly closed by the outer keyless signer before a signature can escape.
- The adapter imports no private key, crypto signer, filesystem, socket, process, environment,
  provider, or secret-resolution capability and remains absent from API and worker entrypoints.
- No deployment, publication, provider activation, spend, DNS change, commercial commitment, or
  Level-4 action occurs.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

The worker carrier signer can now be bound to the existing kernel-attested local IPC client without
duplicating native socket logic or weakening carrier-specific bounds. Production still requires an
approved signer socket identity/path, bounded native client construction, signer service and
custody, lifecycle ownership, carrier byte channel/listener, and verified authenticated round trip.
