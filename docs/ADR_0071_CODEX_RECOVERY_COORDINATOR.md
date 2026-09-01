# ADR-0071: Deny-default Codex recovery coordinator

Date: 2026-09-01

## Context

ADR-0069 defines independent retained-identity exit observation and ADR-0070 defines durable recovery
completion admission. Without a shared composition, a future worker could call those boundaries out of
order, reuse a lease concurrently, or invoke completion after the lease expired.

## Decision

Add a bounded Agent Bridge coordinator that revalidates the active work item, excludes concurrent use
of the same lease generation, obtains exit evidence through the injected evidence source, revalidates
the work item and evidence immediately before completion, and only then invokes an injected durable
completion authority.

Both injected ports deny by default. Completion failures produce no successful result, and the
in-memory concurrency claim is released on every path so a durable idempotent retry remains possible.

## Security and truth boundary

- The coordinator has no process locator, native handle, stream, secret, transport, provider, database,
  deployment, signal, termination, or retry implementation.
- The evidence source remains solely responsible for independently retained native identity. The
  completion authority remains solely responsible for serializable durable admission.
- A lease that expires during observation is withheld from completion.
- Success reports only that the injected authority returned after receiving exact evidence. It does
  not create authenticated terminal protocol evidence or connected-state truth.
- Production defaults deny both ports. Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

A future internal worker can compose already-reviewed boundaries without duplicating ordering,
concurrency, freshness, or truth logic. A positive OS-specific retained-identity source, cleanup action,
and production worker binding remain separate reviewed work.
