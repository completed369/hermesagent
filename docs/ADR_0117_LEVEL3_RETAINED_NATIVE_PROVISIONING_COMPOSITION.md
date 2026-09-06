# ADR-0117: Level-3 retained-native provisioning composition

Date: 2026-09-06

## Context

ADR-0112 and ADR-0115 supplied exact one-use Level-3 API authorities for module-path and parent-
directory provisioning. ADR-0096 and ADR-0115 supplied real retained-descriptor Linux-x64 hosts,
but their public factories still required callers to provide an authority port directly. The
production-shaped positive authority-to-host join therefore remained missing.

## Decision

Add two API-side construction functions. Each accepts one trusted operational capability, exact
workspace context, exact expected request, and one shared clock. It constructs the corresponding
Level-3 authority and supplies only that authority and clock to the real retained-descriptor parent
or path provisioner factory.

Construction performs no filesystem operation. The returned provisioner remains one-attempt and
revalidates the exact request, authorization lifetime, platform, owner, mode, digest, retained
identities, and cancellation state before its host can act. No caller-provided host is accepted.

## Security and runtime-truth boundary

- Invalid, runtime, AI-COO, non-Level-3, cross-workspace, drifted, or replayed authority remains
  denied by the existing adapters and provisioners.
- The path factory cannot create, replace, or remove the shared socket directory; it remains bound
  to the parent-produced Linux device/inode identity.
- Both functions remain absent from the Nest module, routes, workers, schedulers, CLIs, image
  commands, deployment, and publication configuration.
- This change configures no writable runtime root or shared mount and performs no provisioning by
  itself. It packages or loads no module, opens no socket, starts no service, and provisions no
  signer or root.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`. No provider is activated, no
  money is spent, no DNS is changed, no commercial commitment is made, and no Level-4 boundary is
  crossed.

## Consequences

There is now one explicit production-shaped join from reviewed Level-3 authority to each real
provisioning host, without an alternate injected positive host. A later bounded operation may
derive and sequence parent, CLIENT, and LISTENER requests, but must first resolve writable runtime
topology, process identity visibility, cleanup/retry ownership, signer/root custody, and service
lifecycle without weakening the existing invariants.
