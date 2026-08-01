# Workflows

## Engine

Temporal, via `@temporalio/{client,worker,workflow,activity}`. No custom
workflow engine (explicitly forbidden by master spec section 8/33).

## Phase 1: `helloWorkflow`

`apps/worker/src/workflows/hello-workflow.ts` — proxies a single activity
(`pingHealthActivity`) with a 30s timeout and 3 retries, returning a
durable, deterministic result. It remains available for explicit development
verification of the Phase 1 acceptance criterion "Temporal test workflow
executes," but health endpoints do not start it. `GET /api/health/temporal`
uses only the non-mutating gRPC Health `Check`; see `docs/HEALTH_CHECKS.md`.

## Phase 3: `boardApprovalWorkflow` (implemented, live-verified)

`apps/worker/src/workflows/board-approval-workflow.ts` implements the board
review + founder approval slice of the master spec section 24 workflow:

1. Runs `runBoardReviewActivity` (thin wrapper over
   `@ventureos/agent-runtime`'s `runBoardReview`) — persists all 8
   `BoardVote` rows, any `BoardVeto` rows, and the `DecisionSummary`.
2. Calls `createApprovalRequestActivity`, passing the workflow's own ID
   (`workflowInfo().workflowId`) so the Approval Centre can later signal it
   back.
3. Blocks on `condition(() => decisionReceived, '7 days')`, waiting for a
   `founderDecision` signal (`defineSignal<[{ approvalRequestId: string }]>`)
   sent by `ApprovalsService.decide()` once the founder acts in the Approval
   Centre UI.
4. Returns `{ boardReviewId, approvalRequestId, finalState }` once signalled
   or after the 7-day timeout.

Started by `BoardService.startReview()` (`apps/api/src/modules/board`) via
`client.start('boardApprovalWorkflow', { taskQueue, workflowId, args })`,
with a `BOARD_REVIEW_STARTED` audit event recorded alongside.

**Live-verified end-to-end on 2026-07-13**: triggered a real Board Review
from the Board Room UI against the seeded Social Media Content Planning Kit
venture proposal — the worker picked up the workflow task, ran all 8 mock
board agents, persisted votes/decision summary, created a real Approval
Request, and the Approval Centre UI correctly displayed it as `PENDING`.
Deciding `APPROVE` in the UI transitioned the request to `APPROVED`,
persisted an `ApprovalDecision` row, and recorded a matching
`APPROVAL_DECIDED` audit event — confirmed via the Audit Centre.

Workflow properties in place: retries/timeouts on activities (via
`proxyActivities`), duplicate-vote protection (unique constraint on
`[boardReviewId, agentRole]`), approval expiry (`expiresAt`, default 7 days),
hash-mismatch rejection (`isApprovalValidForExecution`, re-checked on every
decision against the proposal's _current_ latest version), and resume-after-
restart (Temporal's durable execution model). Not yet exercised live: the
signal-wait timeout path and worker-restart-mid-workflow recovery — both
follow directly from Temporal's guarantees but haven't been explicitly
forced in a test.

## Phase 4+: Opportunity-to-Product Draft Workflow

The remaining steps of the full 32-step workflow (master spec section 24) —
mock product generation, QA/licensing/policy checks, a second approval gate,
and explicit non-publication — are architected (see
`packages/workflows/README.md`) but not implemented. They require the
Product/Listing domain modules that don't exist yet (Phase 4); building that
workflow shell first would produce dead code.
