# ADR-0018: Unified operational event and audit spine foundation

**Status:** Accepted foundation

## Context

The Agent Control Plane, AI COO, and Dynamic Agent Factory introduced separate in-memory event
views. Those views are useful deterministic projections, but they are not a durable company audit
record. The existing product `AuditEvent` table and `AuditService` already provide the correct
application-owned persistence boundary, so the control plane must integrate with that boundary
rather than create a second database ledger.

Level-4 Founder decision cards remain pending-only. An approval-to-execution path must not be
added until decisions and execution permits can rely on authenticated, workspace-scoped, replay-
protected audit evidence.

## Decision

Introduce a provider-neutral `OperationalEvent` envelope and `OperationalEventSink` port in
`@ventureos/agent-control-plane`.

The envelope:

- has an allowlisted observable event type;
- binds workspace, authenticated actor, actor kind, source, subject, occurrence time,
  idempotency key, and optional correlation ID;
- accepts only event-type-specific facts; identifiers/codes use a restrictive
  character set, counters are non-negative safe integers, and arbitrary titles,
  reasons, prompts, transcripts, and payload field names are replaced by derived
  lengths, counts, booleans, or other non-sensitive metadata;
- rejects custom prototypes, unsafe numbers, secret/private-reasoning field names, common
  credential material, oversized values, duplicate IDs, and idempotency replays;
- sorts equal-time in-memory projections deterministically by event ID;
- never contains prompts, transcripts, raw command input, credentials, or chain-of-thought.

The Control Plane projects authenticated external telemetry as field count and byte count, not raw
payload content or field names. The AI COO and Dynamic Agent Factory publish only schema-approved,
derived state-transition facts through an injected sink while retaining their existing read
projections for compatibility. Every sink call requires an application-issued source capability
that binds a specific workspace and authenticated principal to its actor kind; payload-supplied
workspace, source, or actor-kind claims cannot select another namespace. Sink injection does not
claim that a production ACP process is configured.

`OperationalEventCapability.issue()` is intentionally a trusted composition-root authority. Only
server-side composition code may call it after resolving the authenticated principal, workspace,
source, and actor kind. A controller, request payload, runtime message, or adapter must never mint
its own capability. No production ingestion wiring is introduced by this foundation.

`AuditService.recordOperationalEvent` is the durable application persistence mapper. It validates
the event again, preserves runtime/agent principals in an immutable textual actor reference, and
uses the nullable user relation only for a matching authenticated human. It is not yet wired into
the synchronous reference sink; production wiring requires the transaction/outbox boundary below.

The audit migration adds:

- immutable workspace and actor references that survive relational erasure;
- source event ID and workspace/source uniqueness;
- workspace/source idempotency uniqueness;
- source, occurrence time, and integrity version;
- a database trigger that rejects changes to immutable event content.

The existing nullable workspace and actor relations may only transition to `NULL`, preserving the
existing `ON DELETE SET NULL` tenant/user erasure semantics. Explicit row deletion remains a
governed retention or erasure operation. This foundation does not claim an undeletable ledger.

## Integrity boundary

`integrityHash` is a deterministic checksum over immutable versioned content and operational
provenance. The nullable relational `actorId` pointer is deliberately excluded because governed
user erasure clears it; the immutable `actorReference` remains bound. It detects accidental
mutation and supports verification when the stored checksum is independently trusted. It is not
a digital signature, external transparency log, hash chain, or claim of cryptographic
tamper-proofing against a database administrator who can rewrite both content and checksum.
Every optional persisted version-2 field is canonicalized to explicit `NULL` before hashing and
insertion, so omitted values, caller-supplied nulls, and a database row read produce the same
verification shape.

Database uniqueness is the durable replay boundary. The in-memory log is only the reference
contract and test projection.

## Failure and transaction boundary

The synchronous sink is a reference/test seam, not a claim of durable transactional delivery.
Some in-memory operations publish before their final local map write; AI COO orchestration also
coordinates broker and factory mutations that cannot be made atomic through this port. A future
durable ACP service must write domain state and its outbox/audit event in one database transaction,
then project the outbox idempotently. Production code must not inject a remote/durable sink into
these reference classes and mistake sequential calls for an atomic commit.

The existing venture approval engine predates this ACP foundation. Transactional reconciliation
of its decision write and audit event remains a separate bounded follow-up and must preserve the
existing hash/version/expiry checks.

## Deferred work

- durable ACP task, run, grant, connection, and event persistence;
- transactionally coupled state plus outbox/audit writes;
- authenticated, rate-limited ingestion and event projection APIs;
- retention-policy service and authorized deletion evidence;
- external anchoring or signatures if the threat model later requires administrator-resistant
  verification;
- the ACP approval bridge and single-use execution permits;
- runtime adapters and real runtime connectivity evidence.

No provider call, deployment, publication, runtime connection, DNS change, paid-provider
activation, or production mutation is introduced here. Codex, Hermes, and Pi remain
`NOT_CONFIGURED`.
