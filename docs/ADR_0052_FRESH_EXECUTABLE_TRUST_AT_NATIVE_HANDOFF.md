# ADR-0052: Fresh executable trust at native handoff

Status: Accepted (production source remains unconfigured)

## Context

ADR-0051 authenticates short-lived executable-authority trust snapshots and prevents rollback. The
supervisor composition previously accepted one fixed authorization verifier for preparation and
execution. That could leave a prepared launch dependent on authority state that was no longer the
freshly authenticated state at the native boundary.

## Decision

`TrustedSupervisorComposition` can consume the explicit
`LinuxExecutableAuthorityTrustSource`. When that source is configured, the composition reads it:

1. before requesting and validating each executable authorization decision; and
2. again at the start of `execute`, before plan activation, request consumption, handoff creation,
   or invocation of the native launcher.

The verifier returned by each authenticated snapshot is used throughout that decision phase,
including evidence reading and admission validation. The explicit deny source reports
`AUTHORIZATION_NOT_CONFIGURED`; a configured source that rejects or fails reports
`AUTHORIZATION_DENIED`. There is no asynchronous gap between the execution-phase trust verification
and the composition-owned native handoff.

The API composition root supplies the existing deny-only trust source. It does not install a root
record, snapshot reader, checkpoint store, executable authority, or process launcher.

## Consequences

- A plan cannot reach native handoff solely on authority trust observed during preparation.
- Snapshot expiry, revocation, rollback, or source failure can deny execution after preparation.
- Test-only deterministic and native fixtures may continue to inject a fixed verifier without a
  trust source. A non-test manifest is denied unless the trust source is explicitly present.
- Codex, Hermes, and Pi remain `NOT_CONFIGURED`; no runtime connection or deployment is claimed.

## Next boundary

Provide reviewed durable implementations of the snapshot reader and signer-scoped checkpoint store,
then configure root records through an authenticated operator-controlled composition path. That work
must preserve the current deny default and requires separate operational review before any real
native launch authority is enabled.
