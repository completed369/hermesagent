# ADR-0130: API-coordinator topology carrier public-root source

Date: 2026-09-07

## Context

ADR-0126 durably stores exact-binding public roots and immutable Level-3 admission evidence, while
ADR-0127 requires each carrier role to resolve the opposite role's root before trusting a delivery.
The generic source port deliberately remained unimplemented. Directly handing the registry to a
composition would leave role selection, binding reuse, cancellation, and post-read expiry checks to
the caller.

## Decision

Add an uncomposed, one-use API-coordinator source backed by the ADR-0126 PostgreSQL registry. Its
binding is validated and captured at construction. Its only permitted lookup is the exact
`WORKER_CLIENT` grant for that same canonical binding; requests for the coordinator root, a changed
binding, a missing or ambiguous row, or malformed state deny.

The lookup races cancellation and the binding's own expiry. A database operation that cannot be
cancelled may finish internally, but its result cannot escape after either boundary. After the read,
the source revalidates both binding lifetime and the returned root's version, role, principal,
binding hash, revocation state, and validity coverage. All failures are normalized at the source
boundary, and a failed attempt still consumes the instance.

## Security and runtime-truth boundary

- The source reads only the opposite worker's public SPKI grant from the existing tenant-,
  supervisor-, carrier-, binding-, and role-scoped registry. It has no provisioning authority.
- The source stores no private key and provides no signing operation. The independent response
  authenticator still verifies every signature.
- The worker-side source remains absent; it will require a separately authenticated cross-role
  lookup rather than direct database coupling.
- The adapter remains absent from the API module and worker entrypoint. No carrier route, signing
  service, shared mount, process, provider, deployment, publication, spend, DNS change, or Level-4
  action is introduced.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

The API coordinator now has a narrow production-shaped path from durable admitted public-root state
to the ADR-0127 port without broadening authority or claiming a live channel. Remaining work includes
the authenticated worker root source, independently authenticated signing and carrier transports,
routing, the missing shared runtime mount, and a verified end-to-end runtime round trip.
