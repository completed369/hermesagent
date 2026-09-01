# ADR-0074: Bound Codex recovery execution authority

Date: 2026-09-01

## Context

ADR-0073 makes an active recovery lease, work item, and exact durable dispatch available as one
atomic bundle. ADR-0071 provides the ordered coordinator and ADR-0072 provides its durable completion
port. A future worker still needs a narrow composition that cannot substitute a different lease,
invoke the coordinator with caller-selected work, or reuse one in-memory authority concurrently.

## Decision

Add a Level-3 control-plane factory that cross-checks one active recovery lease against the validated
work item, exact dispatch, workspace principal, actor kind, generation, claim window, lease window,
and fixed `NOT_CONFIGURED` truth. It composes the existing bounded coordinator with the exact durable
completion authority and exposes a frozen, zero-argument, single-attempt execution port.

The injected retained-identity evidence source still denies by default. The execution port marks its
attempt consumed before observation begins, so concurrent or repeated use of the same in-memory port
is rejected. Durable replay remains available only by reconstructing a fresh authority from the
still-active, idempotent lease bundle.

## Security and truth boundary

- Creating the port requires an already-issued Level-3 control-plane capability and exact owner
  binding.
- The caller cannot choose or mutate the work item at execution time.
- The default composition cannot observe a process and therefore cannot complete recovery.
- The factory adds no inventory polling, timer, retry loop, process locator, native handle, signal,
  termination, launch, stream, secret, provider, deployment, or runtime-state transition.
- Successful completion remains cancellation-only and database-clock-authoritative. Codex, Hermes,
  and Pi remain `NOT_CONFIGURED`.

## Consequences

A future bounded internal worker can consume one atomic lease bundle through a minimal execution port
without receiving broad database service authority. Inventory scheduling, positive OS-specific
retained-identity evidence, native cleanup action, and authenticated real-runtime traffic remain
separate reviewed work.
