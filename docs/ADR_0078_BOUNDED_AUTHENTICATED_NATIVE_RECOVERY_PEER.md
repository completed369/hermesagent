# ADR-0078: Bounded authenticated native recovery peer controller

Date: 2026-09-02

## Context

ADR-0077 defines a fresh, fully bound recovery challenge and an Ed25519 response verifier, but it
does not define the controller on the native-supervisor side of that exchange. A peer must not turn
the recovery request into a caller-selected PID lookup or sign a response before independently
revalidating the retained launch identity and completing bounded cleanup.

## Decision

Add a local retained-native recovery peer controller with a narrow native-authority port:

- the peer independently validates the exact ADR-0077 request shape, two-second window, production
  Linux scope, full domain-separated request hash, and unchanged `NOT_CONFIGURED` truth;
- the native authority receives the frozen request and an abort signal. The request contains the
  complete launch binding but no PID, pidfd value, process handle, executable path, or other reusable
  process locator;
- the authority must echo the fresh challenge and binding and attest that a pidfd retained since the
  original launch was re-read after the challenge, the process had exited inside its claim window,
  and the process group was gone after bounded cleanup;
- the controller has its own request-deadline race, propagates cancellation, calls the authority at
  most once, and rejects late, malformed, accessor-backed, replayed, or cross-binding observations;
- only after those checks does it sign the existing ADR-0077 response with a process-local Ed25519
  identity whose public-key hash is checked at construction; and
- cleanup-specific and native-identity details are deliberately omitted from the normalized durable
  recovery evidence.

The native authority and signing identity both deny by default. This change exports the peer
controller but does not compose it into the API, worker, scheduler, or any runtime adapter.

## Security and truth boundary

- This is a controller and contract, not a native pidfd implementation. A positive implementation
  must retain the identity at launch and re-read it without accepting a caller-selected locator.
- The signing key is injected process-locally. Durable provisioning, rotation, revocation,
  anti-rollback, secure key custody, and local IPC peer authentication remain separate work.
- The controller performs no process discovery itself, launch, signal, filesystem access, network
  connection, secret resolution, provider access, deployment, publication, spend, or runtime-state
  transition.
- A signed response remains recovery evidence only. It is not registration, capability, heartbeat,
  task, result, usage, connection, or revenue evidence.
- Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

The next native-runtime slice can supply Linux-only CI evidence for an authority that retains a
pidfd from launch, revalidates it after the challenge, observes exit, and proves process-group
cleanup. Production IPC, trust/key provisioning, worker scheduling, API composition, and a real
authenticated Codex round trip remain unfinished.
