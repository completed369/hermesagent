# ADR-0140: Authorized topology carrier root-lookup listener lifecycle

Date: 2026-09-07

## Context

ADR-0136 can compose the API coordinator's durable public-root source, root-lookup protocol handler,
and kernel-authenticated Linux endpoint, but it accepts an already-authorized local IPC binding. The
retained-native supervisor already owns a one-session listener lifecycle behind Level-3 service
authority. Reusing an observation service purpose for root lookup would confuse two different
protocols and weaken the evidence boundary.

## Decision

Add a distinct `TOPOLOGY_CARRIER_ROOT_LOOKUP_API_LISTENER` service purpose and a one-use service-owner
method. It accepts only the concrete bounded root-lookup handler, validates the exact live carrier
binding before service authorization, requires its workspace and supervisor to equal the issued
grant, and runs one exchange within the shorter of the grant lifetime and session deadline.

The listener lifecycle derives the endpoint identity from the exact newly created socket and derives
the worker principal from `SO_PEERCRED`. It then constructs the authenticated root-lookup endpoint,
handles one request, closes the accepted session, and removes only the owned socket identity.

## Security and runtime-truth boundary

- Root lookup cannot consume recovery, signing, or topology-observation service authority.
- Structural handler spoofs, expired or malformed carrier bindings, cross-workspace scope, and
  cross-supervisor scope fail closed before listener creation.
- The socket path, parent identity, owner-only modes, worker PID/UID/GID, and bounded lifetime remain
  fixed by the existing Level-3 grant and listener lifecycle.
- The change adds no application route, service loop, path discovery, native binding, loader,
  database composition, shared mount, or positive runtime authority.
- No deployment, publication, provider activation, spend, DNS change, commercial commitment, or
  Level-4 action occurs.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

The API protocol now has a reviewed one-session ownership boundary without becoming reachable from
the application. Remaining work must explicitly compose an approved native listener module, exact
path and principal authorization, API application lifecycle, worker counterpart, and verified
authenticated round trip before any runtime can be reported connected.
