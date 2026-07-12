# @ventureos/workflows

**Status: PARTIALLY IMPLEMENTED.**

- `src/client.ts` - shared Temporal `WorkflowClient` factory, used by
  `apps/api` (to start/query workflows) so the API never needs to depend on
  the worker process directly.
- The Phase 1 connectivity-proof workflow itself (`helloWorkflow`) is
  implemented in `apps/worker/src/workflows/hello-workflow.ts`, registered
  with the worker's task queue, and started via `GET /api/health/temporal`.

The full **Opportunity-to-Product Draft Workflow** (master spec section 24)
belongs here and is planned for Phase 3 onward, once the Board/Approval/
Product domain modules it orchestrates exist. Building it now would produce
dead code with nothing real to call.
