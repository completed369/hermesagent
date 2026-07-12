# @ventureos/workflows

**Status: PARTIALLY IMPLEMENTED.** The Phase 1 Temporal connectivity check
lives directly in `apps/worker` (a minimal `helloWorkflow`) to prove the
worker can connect to Temporal and execute a durable workflow end to end.

The full **Opportunity-to-Product Draft Workflow** (master spec section 24)
belongs here and is planned for Phase 3 onward, once the Board/Approval/
Product domain modules it orchestrates exist. Building it now would produce
dead code with nothing real to call.
