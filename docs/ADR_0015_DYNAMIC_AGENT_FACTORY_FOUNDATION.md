# ADR-0015: Governed Dynamic Agent Factory foundation

**Status:** Accepted foundation

The Agent Control Plane gains a provider-neutral, deterministic factory for temporary specialist
agent records. Only configured authorizers or the AI COO may request instantiation. Templates cap
capabilities, tool scopes, authority, cost, compute, runtime, retries, children and retention.
Requests must link to registered workspace objectives and tasks and declare repository,
environment, data, acceptance, verification and stop scopes.

The factory fails closed on cross-tenant access, missing linkage, excess grants, Level-4 authority,
budget overflow, concurrency/child/nesting limits, cycles and duplicate request IDs. Completion
cannot orphan active children; temporary records are archived or removed by policy. Every accepted
request emits explainable decision evidence.

This foundation creates no process, runtime connection, provider call, command, deployment or
publication. Codex, Hermes and Pi remain `NOT_CONFIGURED`. Dispatch, durable persistence,
scheduling and external runtime execution remain separately governed work.
