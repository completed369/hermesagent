# ADR-0157: Role-bound retained-native listener peer authority

Date: 2026-09-07

## Context

The one-session retained-native service contract called every authorized peer a worker. That was
accurate for recovery, module-signing, API topology-observation, and API carrier-root listeners, but
not for the worker-side topology observer or the forthcoming worker carrier listener: those accept
an API coordinator peer. Reusing the worker-named fields for API credentials would make the grant
ambiguous and could permit role switching even when PID, UID, and GID happened to match.

## Decision

Replace the inactive service request and listener authorization fields with role-neutral
`expectedPeerPid`, `expectedPeerUid`, and `expectedPeerGid`, and add an exact `expectedPeerRole` to
the service request and grant.

The service kind fixes the only accepted role:

- recovery, module-authorization signing, API topology observation, and API carrier-root lookup
  require `WORKER_CLIENT`;
- worker-client topology observation requires `API_COORDINATOR`.

Validation rejects any mismatch before authority, listener creation, or native access. Exact-key
validation also rejects the removed worker-named service fields; there is no permissive dual-schema
window. The lifecycle passes only the canonical peer credentials into kernel-authenticated session
handlers. The signing-specific custody request retains its worker-specific names because that
protocol can only be entered by the worker client.

## Security and runtime-truth boundary

- Peer role is hashed into the exact request, reproduced by the Level-3 grant, and covered by the
  existing complete-request equality check.
- A grant for an API coordinator cannot be switched to a worker client service, or vice versa.
- The change selects no actual PID, UID, GID, path, listener, module, tenant, service authority,
  signer, or runtime route.
- All owners remain one-attempt, bounded by grant expiry, kernel-attested, exact-cleanup, and absent
  from application composition roots.
- No deployment, publication, provider activation, spend, DNS change, commercial commitment, or
  Level-4 action occurs.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

Listener authority can now represent the API peer required by a worker-side carrier listener
without mislabeling it as a worker or weakening exact service-purpose binding. Remaining work must
add the distinct worker carrier listener purpose and compose its Level-3 grant, owned listener,
ADR-0155 admission, ADR-0156 signer-loaded session owner, and one bounded exchange before runtime
activation can be considered.
