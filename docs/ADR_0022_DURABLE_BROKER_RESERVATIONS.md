# ADR-0022: Durable broker decisions and capacity reservations

## Status

Accepted as a bounded, non-executing Agent Control Plane foundation.

## Context

ADR-0014 introduced a deterministic provider-neutral Runtime Broker, but its
candidate evidence and decisions were memory-only. ADR-0021 therefore kept the
durable Agent Bridge broker-evidence port fail-closed. Passing a caller-authored
route decision to the bridge would permit stale selection, capacity races,
budget over-reservation, or cross-run evidence reuse.

This change must not connect or launch a runtime. Codex, Hermes, Pi, and every
other real runtime remain `NOT_CONFIGURED`. The bridge still has no controller,
transport, socket, network listener, or child-process path.

## Decision

VentureOS persists a normalized broker decision and a short-lived reservation
for an exact workspace, objective, task, run, agent, runtime, and connection.
The reservation also binds the durable task policy version/hash, canonical
routing-request hash, trusted candidate-snapshot reference/hash, selected score,
estimated cost, required compute, concurrency limit, and a canonical evidence
hash. Candidate evaluations store only fixed numeric factors and controlled
rejection codes; no prompts, transcripts, explanations, credentials, or private
reasoning are accepted.

The application derives routing requirements from the locked durable task/run.
Callers cannot supply a routing policy or selected runtime. A trusted candidate
reader supplies server-owned evidence, the existing pure broker makes the
decision, and the service re-reads and reroutes after locking the selected
connection. Production composition deliberately returns no candidates. Only an
explicit isolated test gate can provide positive synthetic candidate evidence.

Reservation creation is `SERIALIZABLE`. It locks run, task, and connection in a
fixed order, expires stale unclaimed holds, and includes both `RESERVED`
(unexpired) and `CLAIMED` rows when enforcing capacity and reserved cost/compute.
This bookkeeping is a hold, not a `CostLedgerEntry`, payment, invoice, provider
charge, or evidence of spend.

The database atomically claims the exact reservation when a correlated bridge
dispatch row is inserted. The trigger locks the reservation before sampling the
database clock, then rejects expired, reused, drifted, cross-agent, cross-run,
cross-runtime, and non-isolated test evidence. A claimed hold remains capacity-
active until the correlated dispatch becomes `COMPLETED`, `FAILED`, or
`CANCELLED`, when it is released exactly once. A composite foreign key prevents
application or alternate database writers from weakening the exact binding.

Only Level 0–3 prepared runs are eligible. Level 4 remains blocked until a later
change links a currently valid, exact, one-use execution permit to assignment
and dispatch.

## Security properties and limitations

- Workspace, task, run, agent, runtime, connection, policy, candidate evidence,
  and idempotency bindings are exact and migration-backed.
- Lock-first database-time expiry avoids evaluating time predicates before a
  contended row lock.
- Reservation and evaluation evidence is immutable except for the constrained
  reservation lifecycle `RESERVED -> CLAIMED -> RELEASED` or
  `RESERVED -> EXPIRED`.
- Tenant deletion remains possible through explicit cascading erasure. Audit
  records retain governed references according to the existing retention model.
- Hashes provide deterministic integrity evidence; they are not signatures and
  this design does not claim cryptographic tamper-proof storage.
- Runtime candidate `activeRuns` must exclude these reservation rows; the
  reservation service adds durable active holds under the connection lock.
- Expired rows are logically inactive and may be archived later. This slice adds
  no scheduler or cleanup worker.

## Deferred

- authenticated production candidate evidence and a real `CONNECTED` status;
- production secret resolution and credential rotation;
- OS process supervision, sandboxing, transport, and adapter activation;
- Level-4 execution-permit linkage;
- reconciliation of measured usage into company Finance cost ledgers;
- controllers, APIs, Mission Control UI, notifications, and deployment.
