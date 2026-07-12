# Workflows

## Engine

Temporal, via `@temporalio/{client,worker,workflow,activity}`. No custom
workflow engine (explicitly forbidden by master spec section 8/33).

## Phase 1: `helloWorkflow`

`apps/worker/src/workflows/hello-workflow.ts` — proxies a single activity
(`pingHealthActivity`) with a 30s timeout and 3 retries, returning a
durable, deterministic result. Started by `apps/api`'s
`TemporalHealthService` via the shared client in `@ventureos/workflows`, and
exposed at `GET /api/health/temporal`. This exists solely to prove: the
worker registers with Temporal, executes a workflow, calls an activity, and
returns a result — the Phase 1 acceptance criterion "Temporal test workflow
executes."

## Phase 3+: Opportunity-to-Product Draft Workflow

The real 32-step workflow (master spec section 24) — founder approval
signals, board review orchestration, mock product generation, QA/licensing/
policy checks, a second approval gate, and explicit non-publication — is
architected (see `packages/workflows/README.md`) but not implemented. It
requires the Opportunity/Evidence/Board/Approval/Product domain modules that
don't exist yet; building the workflow shell first would produce dead code.

Planned workflow properties once built: retries, timeouts, revision loops,
cancellation, idempotency, duplicate-signal protection, approval expiry,
hash-mismatch rejection (via `isApprovalValidForExecution`, already
implemented and unit-tested in `@ventureos/contracts`), and resume-after-
restart (Temporal's durable execution model gives this by default).
