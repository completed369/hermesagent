# CI & Repository Governance (Phase 9.1)

This document records the state of Continuous Integration and repository
governance for VentureOS as established by Phase 9 Slice 9.1. It supersedes
any older "CI has never run" framing in `docs/KNOWN_LIMITATIONS.md`.

## CI architecture

- Workflow file: `.github/workflows/ci.yml` (job `build-and-test`).
- Triggers: push to `main`, pull request to `main`, and `workflow_dispatch`
  (manual). No deployment steps.
- Runner: `ubuntu-latest`, Node 22, pnpm (exact version from
  `package.json` `packageManager: pnpm@9.12.0`, enabled via corepack).
- Frozen lockfile: `pnpm install --frozen-lockfile`.
- PostgreSQL service container (`postgres:16-alpine`) with health check,
  used for migration apply and integration tests.
- Least-privilege job permissions: `contents: read`.
- Concurrency group cancels superseded runs for the same ref.
- Job timeout: 20 minutes.
- Dependency caching: pnpm cache via `actions/setup-node` (`cache: pnpm`).

## Exact required check names

The single CI job is `build-and-test`. After checkout and toolchain setup, it
runs, in order:

1. Dependency installation (`pnpm install --frozen-lockfile`)
2. Prisma client generation (`pnpm db:generate`) — runs before typecheck so
   downstream packages can resolve `@ventureos/database` types on a clean
   runner
3. Prisma format check (`prisma format --check`)
4. Prisma schema validation (`prisma validate`)
5. Format check (`pnpm run format:check`)
6. Lint (`pnpm run lint`)
7. Typecheck (`pnpm run typecheck`)
8. Prisma migrate (`pnpm db:migrate` = `prisma migrate deploy`) — intended to
   apply the complete nine-migration chain to the fresh CI database
9. Seed integration fixtures (`pnpm db:seed`) using disposable CI-only founder
   credentials; the auth and board suites explicitly require the `FOUNDER`
   role, default workspace, and voting `AgentDefinition` rows
10. Unit tests (`pnpm test:unit`)
11. Integration tests (`pnpm test:integration` — the root command, so every
    package's integration suite runs, not only `@ventureos/api`)
12. Production build (`pnpm build`)

No `.env` is loaded; CI uses explicit non-production placeholder values only.

## CI versus local validation

- `scripts/run-validation.ps1` (Windows/PowerShell) verifies code quality and
  build on the developer machine: format → lint → typecheck → unit →
  integration → build. It does NOT apply migrations.
- CI is authoritative for **clean-database migration verification**: it
  starts a fresh PostgreSQL, generates the Prisma client, and applies the
  full migration chain via `prisma migrate deploy`.

Always run `scripts/run-validation.ps1` locally before pushing. CI is the
final gate.

Historical green local validation recorded elsewhere in the repository is
developer-machine evidence only. It does not establish that migration, unit,
integration, or production-build stages pass on a clean GitHub Actions runner.

> NOTE: turbo caches build/typecheck outputs. A previously cached green run
> can mask a genuine cold-build failure. If CI reports a "cannot find module
> '@ventureos/database'" or implicit-any error, first ensure the database
> package is built (`pnpm --filter @ventureos/database run build`) before
> trusting a cached local result.

## Historical first main-branch CI run

- Commit `22357e1` (the Phase 9 starting point) was pushed to `main` and
  triggered GitHub Actions run "CI #1".
- Status: **FAILURE** at the build step (`packages/database` `tsc` exited 2,
  annotation "Parameter 'tx' implicitly has an 'any' type").
- Actual root cause: a **missing-artifact cascade** on the clean runner. The
  `@ventureos/database` package `dist/` (its declared `main`/`types`) was not
  present when downstream packages compiled, so they failed with
  "Cannot find module '@ventureos/database'" and their `tx`/`sum`/`run`
  parameters became untyped → implicit-any errors. This is a build-ordering
  problem, not a logic bug in `reset-founder-password.ts` (whose `tx` is
  correctly typed by Prisma 5.22.0's interactive-transaction overload).
- The same committed code builds cleanly once the database package is built
  first (historical local evidence: full `turbo run typecheck` 36/36,
  validation script all-green). This was not a complete green clean-runner
  result.

## Slice 9.1 changes awaiting complete clean-runner verification

1. `packages/database/src/reset-founder-password.ts` — the interactive
   `$transaction` callback parameter is now explicitly annotated
   `Prisma.TransactionClient`. This behaviour-preserving, defensive change was
   intended to prevent the previously observed implicit-any failure in that
   file; the current run does not provide complete clean-runner verification.
2. `.github/workflows/ci.yml` — hardened as described above, most importantly
   generating the Prisma client before typecheck/build to address the
   previously observed missing-artifact cascade. The current pull-request run
   did not reach unit tests, integration tests, or production build, so these
   changes do not yet have a complete green clean-runner result.

## Current pull-request CI evidence

- Pull request #1 is open at commit
  `0f536c7c9511945a135a5a030f34e8908a5a9f4b`.
- Its `build-and-test` check failed in GitHub Actions run `29660695312`.
- Verified step outcomes, in execution order:
  1. Dependency installation: **SUCCEEDED**.
  2. Prisma client generation: **SUCCEEDED**.
  3. Format check: **SUCCEEDED**.
  4. Lint: **SUCCEEDED**.
  5. Typecheck: **SUCCEEDED**.
  6. Prisma migrate: **FAILED** because the CI database connection did not
     succeed.
  7. Unit tests: **SKIPPED**.
  8. Integration tests: **SKIPPED**.
  9. Production build: **SKIPPED**.

This evidence records only where the run stopped. It does not establish why
the database connection failed, a structural defect in the migration chain, or
a verified fix. The current branch has no complete green clean-runner result
and must not be described as CI-ready. One complete green run, including
migration, unit, integration, and production-build stages, remains required.

## Confirmation: both Phase 6 migrations are valid

The two Phase 6 migration directories are **different and complementary**,
not duplicates:

- `20260714051039_phase6_marketplace_pilot` — alters `publication_attempts`,
  creates `marketplace_accounts` and `idempotency_keys`, plus indexes and
  foreign keys.
- `20260714065131_phase6_marketplace_pilot` — alters `approval_requests` to
  add `listingVersionId` (for the `PUBLICATION` approval kind) plus its
  foreign key.

Both are already recorded in the development database with checksums and
completed timestamps, and both applied cleanly to a fresh disposable local
PostgreSQL database during the Slice 9.1 audit. That historical local result
is separate from the failed current GitHub Actions migration step and is not
a green clean-runner result. They MUST remain unchanged: no edit, delete,
rename, squash, or corrective migration. Editing or removing either would
break Prisma's applied-migration history.

## Security features — current repository plan

Verified during Slice 9.1 (read-only GitHub inspection of the run; `gh` CLI
not available in the build environment, so entitlement could not be queried
programmatically):

- **Dependency scanning (repo-level):** `pnpm audit --audit-level=high`
  currently reports **43 vulnerabilities (15 high, 1 critical)**. The
  critical/high item is in `vite` (transitive via `vitest@2.1.9` in
  `apps/api`), advisory GHSA-fx2h-pf6j-xcff. A focused dependency-remediation
  task is required. Per Slice 9.1 rules, the threshold was NOT lowered and
  `pnpm audit` was NOT wired as a required green check (it would currently
  fail and block merging).
- **Dependabot:** configured (`.github/dependabot.yml`) for weekly
  npm/pnpm and GitHub Actions updates, with open-PR limits and automatic
  merging disabled. Dependabot is universally available and does not require
  a paid plan.
- **CodeQL / code scanning:** NOT added. For a private repository, code
  scanning generally requires GitHub Advanced Security (paid). Entitlement
  could not be verified from the build environment. Adding a CodeQL workflow
  that fails on a private plan would break CI, so it was intentionally
  omitted. Re-evaluate when plan entitlement is confirmed.
- **Dependency Review:** NOT added for the same private-plan reason.
- **Secret scanning / push protection:** status NOT verified (requires
  manual founder confirmation in GitHub Settings → Code security). No
  repository secret is committed; CI uses placeholder values only.

### Manual founder actions (GitHub UI)

- Enable secret scanning and push protection if the plan permits
  (Settings → Code security). Verify availability first.
- Enable Dependabot alerts / security updates if the plan permits.
- Configure branch protection on `main` (see below) once CI is green.

## Rollback procedure

All Slice 9.1 changes are additive or config-only plus one type annotation.
To roll back: `git revert` the relevant commit(s) on the feature branch, or
delete the branch before merge. No migration was changed, so no database
rollback is required. If branch protection was enabled manually and causes a
problem, disable it temporarily in the GitHub UI, then re-enable.

## No-seed and no-secret rules

- CI never runs `db:seed`.
- CI never loads a `.env`; it uses explicit non-production placeholder
  values (`POSTGRES_PASSWORD=ci-only-password`,
  `AUTH_SECRET=ci-only-auth-secret-not-a-real-secret-32chars`).
- No production secret, database URL, or GitHub token is committed or printed.
