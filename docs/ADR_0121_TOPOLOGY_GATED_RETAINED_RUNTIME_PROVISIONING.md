# ADR-0121: Topology-gated retained-runtime provisioning

Date: 2026-09-06

## Context

ADR-0119 defined a fail-closed four-boundary provisioning sequence, while ADR-0120 proved that the
API/LISTENER and worker/CLIENT roles can see one exact retained runtime parent. Leaving those
controllers independent would still permit a caller to invoke provisioning without first obtaining
shared-topology evidence for the same plan.

## Decision

Add a one-use composition controller that accepts only exact base instances of the hardened ADR-0120
topology reconciler and ADR-0119 provisioning controller. It validates the complete provisioning plan
before either controller runs and captures their base methods at construction against later
substitution.

The controller first obtains both role-local topology observations, then binds the topology to the
exact plan hash, workspace, supervisor, attempt, runtime-parent path, retained device/inode identity,
effective UID/GID, and role placement. Only after that succeeds may the four provisioning boundaries
run. All provisioning must finish before both five-second topology observations expire and within the
controller's bounded attempt. Cancellation, timeout, clock rollback, topology drift, provisioning
failure, or replay returns no composed result.

## Security and runtime-truth boundary

- A malformed plan reaches neither topology nor provisioning.
- A missing, derived, proxied, substituted, or otherwise non-canonical controller dependency is denied.
- Topology failure makes runtime-root, parent-directory, CLIENT, and LISTENER provisioning unreachable.
- The provisioners still revalidate retained filesystem identities while acting; the topology evidence
  does not replace their checks.
- Success means only `TOPOLOGY_ATTESTED_PROVISIONED_NOT_ACTIVATED` and retains
  `runtimeConnection: NOT_CONFIGURED`.
- The controller supplies no observation or provisioning transport, shared mount, authority grant,
  listener activation, process supervision, provider access, credentials, deployment, or connection.
- It remains absent from API and worker composition roots. The current private-staging topology cannot
  construct it because it has neither a shared runtime mount nor authenticated role-local transports.

## Consequences

Provisioning can no longer be represented as properly sequenced unless exact, fresh, two-role shared
runtime evidence was consumed first. Deployment topology and authenticated transport remain the next
prerequisites before this boundary can be composed or produce runtime evidence.
