# ADR-0059: Bounded Codex process-session ownership

Date: 2026-09-01

## Context

The Codex validation path could authenticate a zero-spend dispatch, drive an already-open bounded
app-server JSONL stream, and emit authenticated completion or cancellation evidence. Its production
surface did not own the lifetime of those streams. The deterministic child-process composition in
tests closed the fixture outside the adapter, so it could not establish a reusable invariant that
no terminal bridge evidence leaves the service before the corresponding process has exited.

This gap must be closed without introducing a positive production launcher, ambient credential
discovery, provider access, runtime status promotion, or a claim of real Codex connectivity.

## Decision

Add a one-shot process-session coordinator with an injected owner port and a deny-only production
default. The coordinator:

1. validates the supervisor binding and exact dispatch identity;
2. authenticates the signed dispatch through the scoped secret lease before asking the owner for
   streams;
3. drives one bounded read-only, no-network Codex validation over the returned stdin/stdout pair;
4. requires an exact owner exit result bound to the supervision identity, session, dispatch, and
   validation-dispatch candidate hash;
5. destroys both streams in every owned-session path; and
6. only after successful cleanup re-authenticates the dispatch and permits the existing runtime
   adapter to sign and emit terminal bridge evidence.

The coordinator returns a domain-bound cleanup evidence hash alongside the existing completion or
cancellation candidate. It expires replay tracking with dispatch authority and bounds cleanup to
five seconds and the remaining authority window. Wrong authentication, owner denial, unsafe
protocol activity, malformed exit evidence, cleanup failure, cleanup timeout, concurrent use, and
replay all fail without bridge output.

## Security and truth boundary

- The exported default owner always denies. This change contains no process spawn, executable
  discovery, shell, network, provider call, or credential source.
- The owner port is a future trusted composition boundary; deterministic child processes remain
  test-only.
- Cleanup evidence proves only what the injected owner reports after the coordinator has closed its
  streams. Production OS supervision, crash recovery, and a positive owner still require separate
  reviewed implementations.
- No task/run assignment, artifact, recognized usage, cost-ledger entry, heartbeat/status update,
  provider access, or connection transition is created.
- Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

The next positive runtime composition cannot emit validation evidence while leaving an owned
process behind, and it cannot open a process before dispatch authentication. A real authenticated
Codex exercise remains provisioning- and approval-gated, and runtime truth must not be promoted
until the complete durable round trip is independently verified.
