# ADR-0016: Governed AI COO objective-decomposition foundation

**Status:** Accepted foundation

## Decision

Introduce a deterministic, provider-neutral AI COO policy model inside
`@ventureos/agent-control-plane`. An authorized planner may submit one workspace-scoped objective,
its projects, and a bounded task dependency graph. The complete graph is validated before it is
published: entity identifiers are workspace-global, all links remain in one tenant and objective,
dependencies must exist, and cycles, self-links, sparse arrays, unsupported fields, unbounded text,
and numeric overflow fail closed.

Task readiness and critical path are calculated with an iterative topological algorithm and
code-point tie-breaking. Tasks carry immutable acceptance, verification, retry, stop, cost,
compute, authority, agent-template, capability, tool, scope, retention, and Runtime Broker routing
policy. An assignment request must match this policy exactly. The COO asks the Runtime Broker for
an evidence-based decision and the Dynamic Agent Factory for a bounded specialist record; it does
not invoke the selected runtime. The returned decision preserves both broker evaluation evidence
and the factory template snapshot/hash. Canonical minimum capability, tool-scope, and authority
requirements for every supported ACP task kind cannot be weakened by the submitted plan.

The factory gains an atomic objective/task linkage registration operation. It validates every ID
and collision before committing any linkage, preventing a failed plan from leaving a partially
registered objective. Existing registration operations also reject overwrites.

Task completion requires exact artifact identifiers and SHA-256 hashes for every acceptance and
verification criterion. A mandatory trusted verifier must confirm that every artifact/hash belongs
to the authenticated workspace and the task's assigned COO run correlation ID; submitted evidence
alone cannot complete work. Usage may be recorded only for assigned work and is checked with
overflow-safe arithmetic against task and objective ceilings. Retry and terminal stop codes are
explicit; readiness changes and material task decisions emit sanitized observable events.

## Authority and approval boundary

Level-4 tasks never receive an agent or runtime assignment. They create an expiring protected
Founder decision card with the requested action, exact target, impacts, alternatives,
recommendation, rollback, and current `PENDING` state. This foundation intentionally provides no
approval-to-execution transition. A later increment must bind an authorized decision to the
existing approval engine's artifact version, evidence set, policy/package hash, expiry, and
revocation checks before any Level-4 execution can become possible.

## Privacy and runtime truth

Inputs use explicit allowlists so hidden fields such as private reasoning or chain-of-thought are
rejected rather than retained. Events contain only observable identifiers, state transitions,
policy facts, and artifact references. No prompt transcript or hidden reasoning is stored.

This increment creates no provider call, process, command, network transport, runtime connection,
deployment, publication, DNS change, paid-provider activation, or production mutation. Codex,
Hermes, and Pi retain their evidence-based runtime statuses; a routing decision is not connectivity
evidence.

## Deferred work

- durable transactional graph, event, artifact, usage, and approval persistence;
- durable server-side artifact/run ownership and content-hash lookup implementation for the required verifier port;
- signed assignment claims with broker-evidence version, policy version, capacity and budget reservation;
- explicit run start, progress, cancellation, timeout, handoff, and terminal result ingestion;
- objective-level outcome roll-up and typed stop-predicate evaluation;
- Founder approval, rejection, hold, expiry, revocation, and stale-decision invalidation;
- authenticated runtime dispatch through reviewed adapters or Agent Bridge transports.

These are release-blocking for real autonomous execution, not implicit capabilities of this
decision/model foundation.
