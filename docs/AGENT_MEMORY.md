# VentureOS Agent Memory

VentureOS agent memory is durable, workspace-scoped advisory context for facts, decisions, episodes, and procedures that should survive individual agent runs. It is VentureOS product memory and remains separate from Pi or any other coding-agent session memory used to engineer this repository.

## Safety model

Every memory record belongs to exactly one workspace. The public `MemoryStore` contract requires an explicit `workspaceId` for put, query, revoke, and supersede operations. The PostgreSQL implementation includes that workspace boundary in every read and mutation; there is no global or cross-workspace recall primitive.

Memory is advisory context only. It never substitutes for current evidence, founder approval, budget authorization, marketplace publication approval, subscription entitlements, or any other deterministic policy gate. A `DECISION` memory should point to the authoritative approval/audit record through `sourceRef` rather than copying authority into memory.

Memory is not the Evidence Trail. Material business claims still use evidence artifacts and claim classifications. A memory may reference evidence, but it must never upgrade an assumption or estimate into a verified fact.

## Record contract

The stable runtime record shape is owned by `@ventureos/agent-runtime` and contains:

- `kind`: `FACT`, `DECISION`, `EPISODE`, or `PROCEDURE`.
- `subject` and `key`: deterministic retrieval coordinates.
- structured `payload`.
- `sourceRef`: required provenance pointer to the authoritative source/audit/evidence record.
- `confidence`: 0 through 1.
- `sensitivity`: `PUBLIC`, `INTERNAL`, `CONFIDENTIAL`, or `RESTRICTED`.
- `createdBy` plus created/updated timestamps.
- optional expiry, revocation, and supersession metadata.

`RESTRICTED` memory is excluded from default recall. Callers may request it only by passing an explicit sensitivity filter such as `sensitivity: ['RESTRICTED']`, and that opt-in is only a persistence-layer filter. The caller must already have passed the application policy/security authorization boundary before restricted memory is retrieved or injected into an agent prompt. `MemoryStore` is not itself the authorization layer.

## Persistence lifecycle

`PrismaMemoryStore.put()` validates the public write contract and inserts an immutable-history memory row.

`PrismaMemoryStore.query()` returns only active records for one workspace. Revoked, superseded, expired, and default-unauthorized `RESTRICTED` records are excluded. Retrieval is deterministic metadata filtering by kind, subject, key, explicit sensitivity, time, and bounded result count; semantic/vector retrieval is intentionally deferred.

`PrismaMemoryStore.supersede()` locks the current record, creates the replacement, and marks the previous record with `supersededById` in the same transaction. The actor responsible for supersession is persisted internally as governance provenance.

`PrismaMemoryStore.revoke()` records `revokedAt` and the revoking actor. Revoked records remain in history but are excluded from normal recall.

There is deliberately no agent-runtime hard-delete operation. Privacy/retention deletion, if required, should be a separately authorized administrative capability with audit evidence rather than an agent convenience method.

## Database controls

The `memory_entries` migration enforces workspace foreign keys, memory-kind/sensitivity/confidence constraints, non-self-supersession, and actor provenance for revocation/supersession. Partial indexes support active workspace/subject/key lookup while preserving historical rows.

Integration tests exercise real PostgreSQL storage and prove workspace isolation, cross-tenant mutation denial, expiry filtering, transactional supersession, revocation, actor provenance, and deterministic metadata filters.

## Capture integrations

The first governed capture integrations are intentionally narrow:

- completed board reviews.
- persisted founder approval decisions.

A completed board review writes one advisory `EPISODE` memory record keyed to the authoritative `BoardReview` and sourced from the persisted `DecisionSummary`. It stores only deterministic identifiers and outcome metadata such as blocked/threshold/recommendation/confidence. This is historical board-review context, not a founder approval.

A founder approval decision writes one `DECISION` memory record keyed by the stable `ApprovalRequest` and sourced from the authoritative `ApprovalDecision`. Later decisions for the same request, including `REVOKE`, supersede the prior active memory entry rather than hard-deleting history.

The `ApprovalRequest` and `ApprovalDecision` tables remain the source of truth. Any protected action must still revalidate the authoritative approval record and the current artifact/package hash through deterministic approval checks. Memory can never resurrect an expired, revoked, stale, or drifted approval, and memory cannot grant or revoke execution authority.

Prompt/retrieval integration is still intentionally deferred. Selected future research, finance, experiment, product, marketplace, and publication capture points may be added later only at explicit successful boundaries. Any prompt injection must remain source-labelled, size-bounded, sensitivity-authorized, and subordinate to current evidence and deterministic policy checks.
