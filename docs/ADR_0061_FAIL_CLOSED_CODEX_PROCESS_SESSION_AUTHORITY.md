# ADR-0061: Fail-closed Codex process-session authority port

Date: 2026-09-01

## Context

ADR-0060 added durable process-session claim and completion operations, while the process-session
coordinator from ADR-0059 remained memory-only. A future composition could therefore open injected
streams without first proving that the exact supervisor/dispatch binding was durably claimed, or
emit terminal evidence before the cleanup result was durably accepted.

## Decision

Add a narrow injected process-session authority port to the coordinator. The coordinator passes the
validated supervisor binding and dispatch to `claim` after bridge authentication and before asking
the owner for streams. After exact process exit and stream destruction, it passes the same binding,
dispatch, and validated cleanup evidence to `complete` before emitting any terminal bridge frame.

Both failures are fail-closed and burn the coordinator's one-shot dispatch identity. The default
authority denies. The port returns no caller-authored authority or runtime truth and exposes no
secret, stream, protocol payload, prompt, transcript, or provider credential.

## Security and truth boundary

- This is a composition seam, not a positive production composition or database client.
- The production owner, secret resolver, transport, and new authority all remain deny-only by
  default.
- A later control-plane composition must bind the port to ADR-0060's Level-3, tenant-scoped,
  append-only operations and preserve their idempotency and locking rules.
- No process launcher, provider access, assignment, usage recognition, spend, deployment, or
  runtime/connection transition is added.
- Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

Tests can now prove the required durable ordering around an injected owner without granting a real
runtime path. A reviewed positive composition and OS-specific recovery owner remain separate work.
