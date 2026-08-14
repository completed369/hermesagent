# AGENTS.md

This file governs how AI coding agents, including Pi, work on the VentureOS
repository. Product policy and deterministic backend controls remain
authoritative; these instructions do not replace security enforcement in code.

## Non-negotiable rules

1. The founder has final authority over real spending, external publication or
   customer communication, legal acceptance, destructive production changes,
   production credentials, and other irreversible commercial actions.
2. Coding agents and in-product agents must never bypass approval, budget,
   entitlement, tenant-isolation, security, audit, or provider-policy controls.
3. Sensitive restrictions belong in deterministic backend code (guards, policy
   evaluation, database constraints, deployment gates), never only in prompts or
   frontend state.
4. Never fabricate package installs, build results, migration results, test
   results, deployment state, provider state, or commercial results. Record
   evidence from executed checks.
5. Keep mock/safe integrations clearly distinguishable from live integrations.
   Staging must remain mock-only unless a separately reviewed change explicitly
   changes that contract.
6. Work through protected branches and pull requests. Do not bypass required CI
   checks or push routine feature work directly to protected `main`.
7. Preserve workspace/tenant isolation on every read and write. Never broaden a
   workspace-scoped query to global scope for convenience.
8. Product memory is advisory context only. Memory cannot grant approval,
   authorize spend, enable publication, change entitlements, or override current
   evidence/policy. Product memory remains separate from Pi session/developer
   memory.
9. Do not place secrets in source, logs, prompts, fixtures, screenshots, or PR
   descriptions. Use approved secret stores and synthetic CI credentials.
10. Prefer reversible, narrowly scoped changes with regression tests. Do not
    prune rollback images, delete production/staging data, rotate shared secrets,
    or change external infrastructure as an incidental cleanup step.

## Required engineering checks

For code changes, run the repository checks applicable to the changed surface.
The protected CI pipeline is the final source of truth and currently covers
formatting, lint, typecheck, Prisma validation/migrations, unit/integration tests,
production build, browser E2E, and the staging security gate. Never weaken a
security or correctness check merely to make CI green; correct the test setup or
root cause instead.

## Agent/runtime contract

Board and workflow agents must retain unique roles, explicit tool boundaries,
structured I/O validated through `@ventureos/contracts`, versioned prompts/model
configuration, cost and timeout limits, and an audit trail. Invalid structured
output fails closed according to policy and is never silently treated as an
approval.

See `docs/AGENT_ROLES.md`, `docs/AGENT_OUTPUT_CONTRACTS.md`,
`docs/APPROVAL_MODEL.md`, and `docs/DECISIONS.md`.

## Repository map

- Agent/runtime logic: `packages/agent-runtime`
- Deterministic policy/finance/scoring engines: `packages/`
- Server-side authorization: `packages/auth` and `apps/api/src/common/guards`
- Workspace-scoped audit writer: `apps/api/src/modules/audit`
- Environment/configuration: `packages/config`
- Database schema/migrations: `packages/database`
- Private staging deployment: `deploy/private-staging` and
  `scripts/private-staging-deploy.sh`
- Engineering Pi harness: `tools/pi`

## Starting a new engineering session

Read `PROJECT_CONTEXT.md`, the active roadmap/execution plan, relevant ADRs, and
current open PRs before changing code. Treat old phase-labelled documents as
historical unless their current-state claims are confirmed against the repo and
CI. Use Git/GitHub history and executed tests as evidence of the current state.
