# @ventureos/agent-runtime

**Status: IMPLEMENTED (Phase 3).**

Houses the board-agent execution harness for the 8 voting board agents plus
the non-voting Decision Synthesiser (master spec section 11):

- `mock-provider.ts` — deterministic mock AI provider (`runMockBoardAgent`,
  `runAllMockBoardAgents`). No live model calls (master spec section 42
  permits/prefers mock providers by default). Always produces
  `AgentOutputSchema`-valid output; fails closed rather than reshaping
  invalid output into a fake approval.
- `decision-synthesiser.ts` — the non-voting Decision Synthesiser
  (`synthesiseDecision`). Purely descriptive: its `recommendation` field
  always mirrors the ALREADY-COMPUTED `calculateBoardVotingResult` output; it
  never votes, approves, overrides a veto, or executes anything itself
  (master spec section 11, explicit prohibition).
- `board-review-runner.ts` — `runBoardReview()`: DB-touching orchestration
  that runs all 8 agents against a venture proposal's current version,
  persists `BoardVote`/`BoardVeto` rows, computes the vote result via
  `@ventureos/policy-engine`, and persists the Decision Synthesiser's
  `DecisionSummary`.
- `approval-runner.ts` — `createApprovalRequest()` / `decideApprovalRequest()`:
  DB-touching approval lifecycle, including hash-bound re-validation via
  `isApprovalValidForExecution` (`@ventureos/contracts`) on every decision.

These are plain async functions (not NestJS services) that import `prisma`
directly from `@ventureos/database`, exactly like `AuditService` and the seed
script do -- this lets both `apps/api` (REST endpoints) and `apps/worker`
(the Temporal board-approval workflow's activities) call the identical
logic, with one source of truth instead of duplicated business logic.
