# Approval Model

**Status: fully implemented and live-verified (Phase 3).** Schema in
`@ventureos/contracts` (`ApprovalRequestSchema`, `ApprovalDecisionSchema`,
`isApprovalValidForExecution`), `ApprovalRequest`/`ApprovalDecision` Prisma
models, the Approval Centre API (`apps/api/src/modules/approvals`), the
Approval Centre UI (`apps/web/src/app/dashboard/approvals`), and the
Temporal `boardApprovalWorkflow` integration are all built and tested (unit,
integration, and a live end-to-end browser pass on 2026-07-13: a real
Approval Request was created by the workflow after a Board Review, decided
APPROVE by the founder through the UI, and the state transition, decision
row, and `APPROVAL_DECIDED` audit event were all confirmed via direct
inspection of the running app).

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
Modeled in `ApprovalState` (Zod enum) and mirrored in the `ApprovalRequest.state`
column. `decideApprovalRequest` (`packages/agent-runtime/src/approval-runner.ts`)
is the single function that may transition state — it re-validates
hash-binding via `isApprovalValidForExecution` against the venture
proposal's _current_ latest version before honoring any decision (except
REVOKE), setting state to EXPIRED and throwing if a newer version has been
created since the request was raised. A `REQUEST_REVISION` decision also
creates a `RevisionRequest` row. Execution/executed-state wiring
(`EXECUTED`/`EXECUTION_FAILED`) is deferred to Phase 4, since there is no
product/listing execution path yet.

## Founder decision → Temporal signal

`ApprovalsService.decide()` (`apps/api/src/modules/approvals/approvals.service.ts`)
persists the decision and audit event first (the DB state is the source of
truth), then best-effort signals the waiting `boardApprovalWorkflow` via
`client.getHandle(workflowId).signal('founderDecision', ...)`. A failed or
missing signal is caught and swallowed — non-fatal, since the approval
decision is already durably persisted regardless of whether the workflow or
worker is reachable at that moment.

## Why hash-binding matters

If any approved artefact (product package, listing, proposal) changes after
approval, its hash changes (`@ventureos/security` `hashObject`), and
`isApprovalValidForExecution` will reject execution — forcing a fresh
approval. This is the concrete mechanism behind master spec section 14's
"If any approved artefact changes: recalculate its hash. Invalidate the
previous approval."
