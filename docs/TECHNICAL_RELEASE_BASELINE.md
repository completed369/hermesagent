# Application Technical Release Baseline

Recorded: 2026-07-30

This record defines the locally verified application technical baseline. It is
not a public release, version, tag, deployment approval, production-readiness
claim, or commercial-launch approval.

## Source identity

- Working copy: `D:\Documents\ventureos-app-clean-20260730`
- Baseline parent commit: `dc912145f8ac3a9a90e0e7566bfefc7740ccbccb`
- Baseline parent subject: `fix(ci): complete PostgreSQL and integration readiness`
- Local branch: `feat/phase9-e2e-release-baseline`
- Expected local commit subject: `ci: add application e2e release gate`
- Remote/upstream: none; this baseline was not pushed

## Architecture summary

VentureOS is a pnpm/Turbo monorepo. The application consists of a Next.js web
application (`apps/web`), a NestJS API (`apps/api`), a Temporal worker
(`apps/worker`), Prisma/PostgreSQL persistence (`packages/database`), and shared
deterministic packages for contracts, authorization, policy, scoring, finance,
agent runtime, integrations, workflows, billing, research, product, marketplace,
security, testing, and observability.

The application E2E release gate exercises the built Next.js and NestJS
applications against a disposable PostgreSQL database. It does not require the
Temporal worker, MinIO, a real AI provider, a real marketplace account, a
payment provider, email, production infrastructure, or customer data.

## Runtime baseline

- CI operating system: `ubuntu-latest`
- CI Node.js: 22
- Repository Node.js requirement: `>=22.0.0`
- Locally validated Node.js: 24.18.0
- Pinned package manager: pnpm 9.12.0
- Repository pnpm requirement: `>=9.0.0`
- Local global pnpm observed: 9.15.9; frozen installation was also verified with
  pnpm 9.12.0
- PostgreSQL: `postgres:16-alpine`, disposable and health-checked
- Playwright: 1.61.1 resolved locally; Chromium is the only installed/required
  E2E browser
- Local Docker engine: 29.6.1; Docker Compose: v5.2.0

## Disposable environment and ports

The validation used only the explicit test-mode environment values and
disposable literals shown below. They are not real credentials.

- PostgreSQL: `localhost:5432`, disposable container with temporary database
  storage
- API: `localhost:3001`
- Web: `localhost:3000`
- API readiness: `GET /api/health/live` returns HTTP 200
- Web readiness: `GET /login` returns HTTP 200
- Provider modes: mock/synthetic only
- Live publishing, advertising, and paid integrations: disabled

The idempotent `pnpm db:seed` command supplies the synthetic founder,
workspace/RBAC, voting agent definitions, mock/disconnected integrations,
plans/subscription, and dashboard data required by integration and E2E tests.
All nine committed Prisma migrations are applied with `prisma migrate deploy`.

## Exact local validation commands

The release validation was executed in Git Bash with this disposable
environment and command sequence. The health check was polled until it returned
`healthy`; every listed command exited zero.

```text
export NODE_ENV=test CI=true
export DATABASE_URL='postgresql://ventureos:ci-only-password@localhost:5432/ventureos?schema=public'
export AUTH_SECRET='ci-only-auth-secret-not-a-real-secret-32chars'
export DEV_FOUNDER_EMAIL='founder@ventureos.local'
export DEV_FOUNDER_PASSWORD='ci-only-founder-password'
export API_PORT=3001 API_CORS_ORIGIN='http://localhost:3000'
export NEXT_PUBLIC_API_BASE_URL='http://localhost:3001' E2E_BASE_URL='http://localhost:3000'
export AI_PROVIDER=mock MARKETPLACE_ETSY_MODE=mock
export FEATURE_LIVE_PUBLISHING_ENABLED=false FEATURE_ADVERTISING_ENABLED=false
export FEATURE_PAID_INTEGRATIONS_ENABLED=false
npx.cmd --yes pnpm@9.12.0 install --frozen-lockfile
pnpm run format:check
pnpm exec turbo run lint --force
pnpm exec turbo run typecheck --force
pnpm db:generate
pnpm --filter @ventureos/database exec prisma format --check --schema prisma/schema.prisma
pnpm --filter @ventureos/database exec prisma validate --schema prisma/schema.prisma
docker run -d --rm --name ventureos-release-validation --tmpfs /var/lib/postgresql/data -e POSTGRES_USER=ventureos -e POSTGRES_PASSWORD=ci-only-password -e POSTGRES_DB=ventureos -p 5432:5432 --health-cmd='pg_isready -U ventureos -d ventureos' --health-interval=2s --health-timeout=5s --health-retries=30 postgres:16-alpine
docker inspect --format='{{.State.Health.Status}}' ventureos-release-validation
pnpm db:migrate
pnpm db:seed
pnpm exec turbo run test:unit --force
pnpm exec turbo run test:integration --force
pnpm exec turbo run test:e2e --force
pnpm exec turbo run build --force
git diff --check
pnpm exec prettier --check .github/workflows/ci.yml
docker stop ventureos-release-validation
```

The canonical application E2E command is `pnpm test:e2e`. It was also executed
without flags during CI-sequence reproduction. Playwright starts the built API
and web package scripts, waits for both readiness URLs, runs four Chromium
tests, and terminates both processes.

## Fresh local results

- Frozen-lockfile installation: PASS
- Format check: PASS
- Lint: PASS, 17/17 Turbo tasks, cache bypassed
- Typecheck: PASS, 36/36 Turbo tasks, cache bypassed
- Prisma client generation: PASS
- Prisma format check: PASS
- Prisma schema validation: PASS
- Disposable PostgreSQL health: PASS
- Nine-migration deployment: PASS
- Synthetic fixture seed: PASS
- Unit tests: PASS, 18/18 participating workspace tasks and 189 tests
- Integration tests: PASS, 8 files and 57 tests
- Application E2E: PASS, 4 tests, Chromium
- Production build: PASS, 20/20 Turbo tasks, cache bypassed; API and web build
  artifacts verified present
- `git diff --check`: PASS
- Workflow YAML parse, Prettier check, and static safety assertions: PASS
- Added-line secret-pattern scan: PASS
- Final cleanup: disposable container removed; ports 3000, 3001, and 5432 closed;
  Playwright success artifacts removed

## Normal CI gates

The normal `.github/workflows/ci.yml` job retains least-privilege
`contents: read` and runs:

1. frozen-lockfile dependency installation
2. Prisma client generation
3. Prisma format check
4. Prisma validation
5. repository format check
6. lint
7. typecheck
8. all committed migration deployment against ephemeral PostgreSQL
9. synthetic fixture seed
10. unit tests
11. integration tests
12. production build
13. Playwright Chromium/runtime installation
14. canonical application E2E (`pnpm test:e2e`)
15. failure-only upload of the Playwright HTML report, screenshots, traces, and
    test results when present

Playwright owns API/web process startup, deterministic readiness, and teardown.
GitHub Actions owns PostgreSQL service-container cleanup. The E2E step fails the
job on any failed test. No deployment, publication, environment, package-write,
OIDC, or production permission was added.

The pre-existing clean GitHub Actions baseline passed in run `30533127793`.
This new E2E addition has been verified locally but, because this work was not
pushed, has not yet run on an external GitHub Actions runner.

## Known non-fatal warnings and operational notes

- Next.js reports missing build-cache optimization and anonymous telemetry
  information during a local cold build; neither is a validation failure.
- Vitest reports that Vite's CJS Node API is deprecated; tests still pass.
- Negative authentication tests intentionally produce HTTP 401/error log lines.
- On the Windows working copy, a stale ignored `apps/api/tsconfig.tsbuildinfo`
  can claim deleted API outputs are current. Cache-disabled verification removed
  that generated file before forced API builds and verified the real
  `apps/api/dist/main.js` artifact. Clean GitHub runners do not inherit this
  local residue.

## Explicitly unfinished production gates

- The E2E-enabled workflow still needs one clean external GitHub Actions run
  after a future approved push.
- Production deployment architecture, environment hardening, backup/restore
  exercises, operational monitoring, and rollback drills are not approved.
- Real AI-provider integration is not enabled or validated.
- Real marketplace publication, payment processing, email delivery,
  advertising, and customer-data processing are not enabled or validated.
- Known security hardening remains, including plaintext-at-rest session tokens,
  complete CSRF protection, MFA/account recovery, dependency vulnerability
  remediation, and confirmation of repository-level secret scanning/push
  protection.
- No production or commercial launch approval has been granted.

## Baseline flags

APPLICATION_TECHNICAL_RELEASE_BASELINE_READY=True
PRODUCTION_DEPLOYMENT_READY=False
REAL_PROVIDER_INTEGRATION_READY=False
COMMERCIAL_LAUNCH_READY=False

No deployment, publication, release, tag, real external integration, real
provider call, marketplace action, payment action, customer communication, or
push occurred while establishing this baseline.
