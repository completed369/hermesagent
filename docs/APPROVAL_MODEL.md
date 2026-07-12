# Approval Model

**Status: schema implemented in `@ventureos/contracts`
(`ApprovalRequestSchema`, `ApprovalDecisionSchema`,
`isApprovalValidForExecution`), unit-tested. No DB table, UI, or workflow
integration yet (Phase 3).**

## Server-side enforcement primitive

`isApprovalValidForExecution(approval, current)` checks three things before
any sensitive action may proceed:

1. `approval.approvedArtifactVersionId === current.artifactVersionId`
2. `approval.approvedPackageHash === current.packageHash`
3. `now < approval.expiresAt`

If any check fails, execution must be blocked — this function is the single
source of truth, called from workflow code (never a frontend check alone).
Unit tests cover all three failure modes plus the happy path
(`packages/contracts/src/__tests__/approval.test.ts`).

## States (master spec section 14)

DRAFT → PENDING → {APPROVED, APPROVED_WITH_CONDITIONS, REJECTED,
REVISION_REQUESTED} → {EXPIRED, REVOKED, EXECUTED, EXECUTION_FAILED}.
Modeled in `ApprovalState` (Zod enum) — ready for a Prisma model once
approvals are built.

## Why hash-binding matters

If any approved artefact (product package, listing, proposal) changes after
approval, its hash changes (`@ventureos/security` `hashObject`), and
`isApprovalValidForExecution` will reject execution — forcing a fresh
approval. This is the concrete mechanism behind master spec section 14's
"If any approved artefact changes: recalculate its hash. Invalidate the
previous approval."
