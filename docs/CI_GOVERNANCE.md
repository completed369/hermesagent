# CI & Repository Governance

## Current-state note

This document began as the Phase 9.1 CI/governance record. Historical evidence
from that slice, including early failed runs, is preserved below as historical
context. Current repository configuration must be read from `.github/workflows/ci.yml`
and the later baseline records, especially `docs/TECHNICAL_RELEASE_BASELINE.md`,
`docs/APPLICATION_SECURITY_BASELINE.md`, and `docs/STAGING_SECURITY_GATE.md`.

The read-only GitHub audit on 2026-08-25 verified product `main` at
`1cdf560dcd9bb8e824fa3bf2b82846ff4c3f1675`, protected with required
`build-and-test` and `staging-security-gate` checks enforced for administrators.
Exact-main CI and CodeQL passed. The same audit observed zero open CodeQL,
Dependabot, and secret-scanning alerts. Those are dated API observations, not a
permanent guarantee that every organization, repository, ruleset, package, or
future commit setting remains unchanged.

The latest observed Dependabot update workflow was not green on a historical
update branch even though the current alert count is zero. Restore a green
recurring dependency-update path; do not infer current vulnerability from that
automation failure, and do not infer healthy automation solely from the zero-
alert snapshot.

## CI architecture in repository configuration

Workflow file: `.github/workflows/ci.yml`.

The normal CI workflow is validation-only. It does not deploy, publish packages,
contact real providers, publish marketplace content, spend money, send external
communications, or change production configuration.

Configured jobs:

1. `build-and-test`
   - Triggered by push to `main`, pull request to `main`, and manual
     `workflow_dispatch`.
   - Runs on `ubuntu-latest` with Node 22 and pnpm from `package.json` via
     Corepack.
   - Uses a disposable PostgreSQL service container.
   - Runs frozen installation, Prisma client generation, Prisma format/validate,
     repository format, lint, typecheck, all migrations present in
     `packages/database/prisma/migrations`, disposable synthetic fixture seed,
     unit tests, integration tests, production build, Playwright Chromium
     installation, and application E2E.
   - Uploads Playwright failure artifacts only on failure.
2. `staging-security-gate`
   - Depends on `build-and-test`.
   - Generates a disposable synthetic local/container staging environment and
     runs `bash scripts/staging-security-gate.sh all`.
   - This provides evidence for the local/container staging-gate topology for
     that CI run. It is not an external staging deployment and not production
     readiness.

Both jobs use least-privilege repository permissions in the workflow
configuration (`contents: read`). Any claim about repository-level security
features outside workflow YAML still requires GitHub-side verification.

## Exact required check names

The configured job names are:

- `build-and-test`
- `staging-security-gate`

If branch protection or rulesets are configured in GitHub, those settings should
require the appropriate current job names after they have a passing run. This
repository evidence alone does not prove that such protection is enabled.

## CI versus local validation

- `scripts/run-validation.ps1` verifies code quality and build on a Windows
  developer machine: format → lint → typecheck → unit → integration → build. It
  does not, by itself, establish GitHub clean-runner status.
- `pnpm test:e2e` runs a production build before Playwright E2E.
- CI is the configured clean-runner validation path at a particular ref:
  disposable PostgreSQL, migration apply, seed, unit/integration/build/E2E, and
  the staging security gate.
- The local/container staging gate is a separate evidence type from both local
  development validation and external deployment state.

Historical green local validation recorded elsewhere is developer-machine
evidence only. It does not establish the current state of GitHub CI unless a
matching GitHub Actions run is recorded.

## Historical first main-branch CI run

The following is intentionally historical Phase 9.1 evidence:

- Commit `22357e1` (the Phase 9 starting point) was pushed to `main` and
  triggered GitHub Actions run "CI #1".
- Status: **FAILURE** at the build step (`packages/database` `tsc` exited 2,
  annotation "Parameter 'tx' implicitly has an 'any' type").
- Actual root cause recorded at the time: a missing-artifact cascade on the
  clean runner. The `@ventureos/database` package `dist/` was not present when
  downstream packages compiled, so downstream packages failed with
  "Cannot find module '@ventureos/database'" and related implicit-any errors.
- This historical run is not the current CI workflow capability and must not be
  used as the only current CI status claim.

## Historical Phase 9.1 pull-request CI evidence

The following evidence is also intentionally historical:

- Pull request #1 at commit `0f536c7c9511945a135a5a030f34e8908a5a9f4b` had a
  red `build-and-test` check in GitHub Actions run `29660695312`.
- Recorded step outcomes: install, Prisma generation, format, lint, and
  typecheck succeeded; Prisma migrate failed because the CI database connection
  did not succeed; later unit, integration, and production-build stages were
  skipped.

This records where that run stopped. It does not establish the current CI state,
a migration defect, a fixed external configuration, or a permanent waiver.
Consult current GitHub Actions evidence for the relevant ref before claiming CI
is green.

## Migration-chain policy

CI should apply all migrations present in `packages/database/prisma/migrations`
to a fresh disposable database. Historical documents may mention exact migration
counts from the time they were written; those counts are snapshots and should not
be treated as permanent documentation.

Historical safety note: the migration directories
`20260714051039_phase6_marketplace_pilot` and
`20260714065131_phase6_marketplace_pilot` have the same descriptive suffix, but
that does **not** mean they are duplicates. They are distinct and complementary
Phase 6 migrations.

Applied migrations must remain immutable. Do not edit, delete, rename, squash,
or "fix" an already-applied migration in place. Add a new forward migration when
a schema change is required, and follow backup/change-control rules for any
production-impacting migration.

## Dependency and security gates

Historical Phase 9.1 records originally recorded unresolved dependency audit
findings. Later security work superseded that finding for the validated lockfile:
`docs/APPLICATION_SECURITY_BASELINE.md` records production and complete audits
with zero findings at every severity for that baseline. This is lockfile-specific
evidence, not a permanent guarantee; frozen install and dependency audits must
remain required for future dependency changes.

Repository-administration features remain separate from code evidence. This
repository contains Dependabot configuration, but GitHub-side settings such as
secret scanning, push protection, branch protection/rulesets, CodeQL/code
scanning, and dependency-review enforcement require administrator verification
or explicit workflow/configuration evidence before being claimed enabled.

## Workflow supply-chain policy

Every external GitHub Action used by a governed workflow is pinned to an exact
40-character commit SHA. A version comment may document the reviewed upstream
release, but a mutable tag is never the executable reference. Container actions
must likewise use an immutable SHA-256 image digest. Repository-local actions
remain reviewed source in the exact checked-out commit.

Pull-request-triggered workflows must not grant `contents: write`, use
`permissions: write-all`, or execute `git push`. No checkout persists the
workflow token. `scripts/workflow-supply-chain-policy.test.mjs` parses every
checked-in workflow as normalized YAML, rejects aliases and merge keys, and
enforces immutable action/container references, checkout credential containment,
and pull-request write denial. Its adversarial fixtures cover flow mappings,
quoted and spaced keys/values, `pull_request_target`, inline write permissions,
mutable job/service/container-action images, and branch pushes.

The one-time Prisma JavaScript-engine remediation is already part of repository
source: the generator uses `engineType = "client"`, the PostgreSQL driver adapter
and client versions are pinned, the client constructs `PrismaPg`, and the frozen
lockfile contains the adapter. The obsolete branch-bootstrap and pull-request
lockfile workflows were removed after that remediation landed; routine CI now
validates the checked-in schema, client generation, frozen lockfile, migrations,
and application suites without mutating a branch.

## Publication and private-staging workflows

The repository also contains manually dispatched, founder-gated workflows for
image publication and private-staging connectivity/deployment templates. Their
presence is configured capability, not proof that images have been published or
that an external staging environment is currently deployed.

Use precise terminology:

- repository configuration exists;
- local development validation evidence exists only for recorded local runs;
- GitHub CI evidence exists only for recorded workflow runs at specific refs;
- local/container staging-gate evidence is not external deployment evidence;
- private-staging deployment templates/workflows are capability, not operational
  state;
- repository evidence alone does not establish the current operational state of
  any externally deployed staging environment;
- production deployment and production readiness require separate evidence and
  founder approval.

## No-secret and disposable-fixture rules

- CI must never load real production secrets.
- CI may seed disposable synthetic fixtures into the ephemeral CI database when
  tests require baseline roles/workspaces/agent definitions.
- No production secret, database URL, provider token, GitHub token, or customer
  credential should be committed or printed.
- Real AI providers, live marketplace publication, payments, advertising, email,
  and external communication remain gated/disabled unless a future
  founder-approved scope explicitly enables and verifies them.
