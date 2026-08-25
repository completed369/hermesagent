# ADR-0020: Durable Agent Control Plane task/run spine

Status: Proposed (implementation under review)

Date: 2026-08-25

## Context

The provider-neutral Agent Control Plane, Runtime Broker, Dynamic Agent Factory,
AI COO, operational audit spine, and approval bridge exist as verified
foundations. The AI COO can identify Level-4 work, but its in-memory task state
does not create durable work that the approval bridge can independently bind to.
Persisting an approval over caller-asserted objective/task/run references would
leave a fabricated-work gap.

## Decision

Add a bounded, service-only durable spine for objectives, projects, tasks,
dependencies, prepared runs, and artifact evidence.

- A pure shared policy validates exact input shapes, bounded JSON, budgets,
  authority minima, retry limits, graph integrity, sensitive-text rejection, and
  canonical policy snapshots before persistence.
- Workspace scope participates in every ACP primary/foreign key. Database
  triggers also reject project/objective drift, cross-objective dependencies,
  dependency cycles, binding mutation, illegal state transitions, and artifact
  correlation drift.
- Every task receives one initial run. Routine work is `PREPARED`; Level-4 work
  is `AWAITING_APPROVAL`, unassigned, and bound to an exact action, target,
  artifact version, evidence hash, policy version, and policy hash.
- The approval bridge re-reads and share-locks that durable Level-4 run inside
  the approval-request transaction. Caller assertions cannot create approval
  work that does not exist in the durable spine.
- Assignment and artifact ingestion require trusted server composition-root
  verifier ports. Production defaults deny all evidence until authenticated
  broker/runtime adapters are wired. Request or runtime payloads cannot mint
  verifier authority.
- State mutations and operational audit inserts share one database transaction.
  Optimistic versions and conditional updates reject concurrent stale writers.
- Completion requires trusted artifacts for every declared acceptance and
  verification criterion. Failure records only a digest of a bounded failure
  code, and retries never exceed the immutable retry budget.

Policy hashes provide deterministic integrity evidence and drift detection. They
are not described as cryptographic tamper proofing.

## Explicit non-capabilities

This change does not expose a controller, dispatch a runtime, connect Codex,
Hermes, or Pi, execute a claimed permit, publish an image, deploy an environment,
activate a provider, spend money, or add a Mission Control UI.

Level-4 runs cannot be assigned by this service. A later, separately reviewed
execution boundary must consume an exact single-use approval permit and add the
required durable permit linkage before any Level-4 assignment transition.

## Erasure and retention

Tenant deletion cascades through the durable ACP graph. User identity is not
stored as a relational ACP task/run owner in this slice. Operational audit rows
retain governed reference evidence under ADR-0018 and remain deletable under the
existing retention/tenant-erasure controls; no trigger blocks deletes.

## Consequences

The next authenticated runtime-adapter or Mission Control change can consume
durable, workspace-scoped task/run facts without inventing a second state model.
Until trusted evidence adapters exist, routine assignments and artifacts fail
closed in the application composition root.
