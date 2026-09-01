# ADR-0060: Durable Codex process-session claims and cleanup

Date: 2026-09-01

## Context

ADR-0059 makes one in-process coordinator authenticate a validation dispatch before opening
injected streams and withhold terminal bridge output until the owner reports process exit. Its
one-shot tracking is memory-local. A service restart could therefore lose the fact that a process
session had been opened, and the durable terminal-evidence path did not require the coordinator's
cleanup evidence.

This gap must be narrowed without adding a positive launcher, provider credentials, provider
traffic, assignment, spend, or a runtime-status transition.

## Decision

Add two append-only, tenant-scoped records to the Agent Control Plane:

1. a process-session claim bound to the exact claimed egress handoff, validation dispatch,
   owner/principal, supervisor identity, launch nonce, admission hashes, platform, and expiry; and
2. a completion bound to that claim and to the coordinator's exact domain-separated cleanup
   evidence, exit result, dispatch identity, and `COMPLETED` or `CANCELLED` reason.

Both operations require Level-3 control-plane authority and use serializable transactions plus
database locks. Replays must reproduce the same identities and idempotency keys. Claims and
completions are immutable except during workspace erasure. Database triggers require the matching
completion row before any new Codex validation completion or cancellation evidence can be
inserted, including inserts that bypass the service.

The completion service revalidates the cleanup hash with the database clock and requires the
supervisor binding to reproduce every claim field. It stores no stream data, protocol transcript,
MAC, prompt, secret, token count, or provider payload.

## Security and truth boundary

- These rows are durable ownership and cleanup evidence, not launch permission or proof that an
  operating-system process actually existed.
- The process owner and production launcher remain deny-only. No service composes a positive
  owner, credential source, or provider path.
- Cleanup hashes provide correlation and integrity; the injected owner remains a future trusted
  boundary and production crash recovery still needs a reviewed recovery worker.
- No run/task assignment, recognized usage/cost, heartbeat/status mutation, artifact, connection
  transition, deployment, or publication is added.
- Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

New durable Codex terminal evidence can no longer omit an exact persisted process-exit result, and
an unfinished claim remains visible across a service restart for a later recovery composition.
Wiring the coordinator to these operations and implementing a positive, OS-specific recovery
owner remain separate reviewed changes.
