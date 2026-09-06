# ADR-0127: Role-local topology carrier composition

Date: 2026-09-07

## Context

ADR-0125 defines mutually authenticated request and response delivery, and ADR-0126 supplies a
durable public-root registry, but neither closes the role-local assembly boundary. A caller could
otherwise accidentally exchange before resolving the worker grant, let the worker observe before
resolving the coordinator grant, or reuse a role object across multiple exchanges.

## Decision

Add uncomposed, one-use coordinator and worker assemblies around the existing carrier protocol. The
coordinator validates its complete binding, signer, raw carrier, attempt reference, clock, and close
deadline before use. It then resolves the exact `WORKER_CLIENT` public root for that binding before
constructing the signed outbound carrier. The worker resolves the exact `API_COORDINATOR` public
root before constructing its inbound authenticator, observation handler, and signed response
endpoint.

Public-root resolution is an injected role-aware port whose default denies. Each lookup receives
the complete immutable binding plus an abort signal, is bounded by the binding's own expiry, and
must return one structurally valid root. The existing signature layer then enforces the exact role,
principal, binding hash, validity, and revocation constraints. Unknown lookup failures deny without
being exposed. Each role can be attempted only once. The coordinator closes its injected carrier
exactly once after success, denial, malformed input, cancellation, or expiry; close itself is
bounded.

## Security and runtime-truth boundary

- The assemblies neither fetch nor provision roots. A production root source remains absent; the
  ADR-0126 registry is not wired here.
- Signers, the underlying carrier, and the observation port remain injected and deny by default.
- The module imports no network, TLS, filesystem, process, environment, queue, database, provider,
  or orchestration implementation and remains absent from API and worker composition.
- No private key, root, route, shared mount, Temporal configuration, activation, deployment,
  publication, spend, DNS change, or Level-4 action is added.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

The application-layer authentication pieces now have an explicit safe ordering and lifecycle at
both roles, without claiming that any channel or runtime exists. A future reviewed composition must
still provide authenticated root admission, role-local public-root adapters, keyless signers, a
bounded concrete carrier, independent infrastructure review, and the missing shared runtime mount.
