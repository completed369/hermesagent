# Workflows

## Engine

Temporal, via `@temporalio/{client,worker,workflow,activity}`. No custom
workflow engine (explicitly forbidden by master spec section 8/33).

## Phase 1: `helloWorkflow`

`apps/worker/src/workflows/hello-workflow.ts` proxies a single activity
(`pingHealthActivity`) with a 30s timeout and 3 retries, returning a durable,
deterministic result. It remains available for explicit development
verification of the Phase 1 acceptance criterion "Temporal test workflow
executes," but health endpoints do not start it. `GET /api/health/temporal`
uses only the non-mutating gRPC Health `Check`; see `docs/HEALTH_CHECKS.md`.

## Phase 3: `boardApprovalWorkflow` (implemented)

`apps/worker/src/workflows/board-approval-workflow.ts` implements the board
review + founder approval slice of the master spec section 24 workflow:

1. Runs `runBoardReviewActivity` (thin wrapper over
   `@ventureos/agent-runtime`'s `runBoardReview`) and persists the board review
   output.
2. Calls `createApprovalRequestActivity`, passing the workflow's own ID
   (`workflowInfo().workflowId`) so the Approval Centre can later signal it
   back.
3. Blocks on `condition(() => decisionReceived, '7 days')`, waiting for a
   `founderDecision` signal (`defineSignal<[{ approvalRequestId: string }]>`)
   sent by `ApprovalsService.decide()` once the founder acts in the Approval
   Centre UI.
4. Returns `{ boardReviewId, approvalRequestId, finalState }` once signalled or
   after the 7-day timeout.

Started by `BoardService.startReview()` (`apps/api/src/modules/board`) via
`client.start('boardApprovalWorkflow', { taskQueue, workflowId, args })`, with a
`BOARD_REVIEW_STARTED` audit event recorded alongside.

Historical live-verification notes from 2026-07-13 are preserved in
`docs/EXECUTION_PLAN.md`. Current release/security evidence is recorded in
`docs/TECHNICAL_RELEASE_BASELINE.md` and `docs/APPLICATION_SECURITY_BASELINE.md`.

## Phase 4: `productListingWorkflow` (implemented, mock product/listing path)

`apps/worker/src/workflows/product-listing-workflow.ts` implements the approved
proposal -> generated product package -> listing-draft approval path. In
summary it:

1. Generates mock product assets through the product-studio package and storage
   abstraction.
2. Runs deterministic QA/licensing checks.
3. Generates a marketplace-facing listing draft only after QA passes.
4. Creates a hash-bound `PRODUCT_LISTING` approval request.
5. Waits for the founder decision signal before completing the workflow state.

The workflow produces product/listing records and approval state; it is not a
real marketplace publication. Real provider use remains outside the established
repository evidence and requires separate founder approval and provider-specific
controls.

## Phase 6: `marketplacePublicationWorkflow` (implemented, mock-only)

`apps/worker/src/workflows/marketplace-publication-workflow.ts` implements the
prepare -> publication approval -> publish sequence against the mock Etsy-shaped
adapter:

1. Prepares a draft/listing-publication attempt through the marketplace runner.
2. Requests a separate hash-bound `PUBLICATION` approval.
3. Waits for the founder decision signal.
4. Runs the mock publish boundary only if the approval is valid and approved.

The current workflow is intentionally mock-only. It records provider-shaped
attempts, idempotency, audit evidence, and blocked/fail-closed states, but it
does not establish a live Etsy account, live Etsy publication, payment,
advertising, external communication, or any production provider capability.

## Workflow properties and evidence boundaries

Implemented workflows use Temporal activity timeouts/retries, persisted domain
state, founder-decision signals, audit events, and server-side approval
revalidation. Repository source/configuration establishes implemented workflow
capability; local development validation, GitHub CI, local/container staging
security-gate evidence, and any separately approved external deployment evidence
are distinct claims and must not be conflated.
