# ADR-0123: Authorized role-local topology observation listener

Date: 2026-09-06

## Context

ADR-0122 authenticates one topology-observation request and response after a local connection has
already been established, but it deliberately creates no listener. Invoking its handler through an
arbitrary socket owner, indefinitely running service, caller-selected role, or unapproved peer would
break the tenant, topology, and kernel-identity bindings established by ADR-0113 and ADR-0120.

ADR-0113/0114 already provide a one-attempt owner and a one-minute Level-3 grant for an exact retained
socket directory, child path, peer principal, and session deadline. Reusing that boundary avoids a
second listener authorization model.

## Decision

Extend the existing retained-native supervisor service contract with two distinct purposes:
`TOPOLOGY_OBSERVATION_API_LISTENER` and `TOPOLOGY_OBSERVATION_WORKER_CLIENT`.

The one-attempt service owner now:

1. requires the purpose to match the exact observer role before consulting authority;
2. requires the existing trusted Level-3 adapter to bind the complete tenant, supervisor,
   provisioning evidence, retained socket-directory identity, socket path, peer credentials, and
   100–5,000 ms deadline into the one-use grant;
3. creates the socket only through the existing no-replacement retained listener lifecycle;
4. constructs the ADR-0122 handler only after the created socket identity is attested, using that
   exact identity and the grant-pinned peer credentials;
5. accepts one request, rechecks the socket around acceptance and response, bounds the handler by the
   shorter of the service deadline and grant validity, then closes the session and unlinks only the
   exact owned socket; and
6. emits no service result or runtime-state transition.

The Linux session boundary recognizes the topology handler as an exact supported handler class; an
arbitrary duck-typed handler remains denied.

## Security and runtime-truth boundary

- The default service authority and topology observer still deny. The Level-3 adapter is one-use,
  tenant-bound, rejects runtime principals and Level 4, and remains absent from application roots.
- API and worker observations are separate service purposes. A grant for one cannot be replayed or
  switched into the other.
- The lifecycle selects no path, peer, role, topology request, module, carrier, or shared mount. It
  consumes only caller-supplied values already fixed by the exact authority grant.
- No daemon, retry loop, discovery, cross-container carrier, shared volume, provisioning composition,
  provider, credential, process launch, deployment, publication, spend, DNS change, or Level-4 action
  is added.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

Each ADR-0122 role-local handler can now be hosted for one explicitly authorized, kernel-attested,
bounded exchange with exact cleanup. Cross-container carrier/orchestration and a real shared runtime
mount are still required before ADR-0121 can be composed or any runtime connection can be claimed.
