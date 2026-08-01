# Local Verification Checklist

Run these in order. Each step states what it proves and what a failure
means. This is the checklist that turns "source code was written" into
"Phase 1 acceptance criteria are actually met" — do not skip steps.

## 0. Preflight

```powershell
.\scripts\preflight.ps1
```

Proves: Docker Desktop running, Node 22, pnpm available, ports free, repo
location sane. **If this fails, fix it before anything else** — every later
step assumes a clean environment.

## 1. Install

```powershell
pnpm install
```

Proves: every `package.json` across the monorepo has consistent, resolvable
dependencies and no version conflicts. This is the FIRST real test of
everything written in this sandbox — nothing before this point has touched
a real npm registry.
**If it fails**: send back the exact error. Most likely causes: a version
range that doesn't resolve, a missing peer dependency, or a workspace
`workspace:*` reference to a package name that doesn't match.

## 2. Infrastructure

```powershell
.\scripts\start-infrastructure.ps1
docker compose ps   # all 4 services should show "healthy" or "running"
```

Proves: `docker-compose.yml` is not just valid YAML (already checked) but
actually starts 4 working containers.

## 3. Format / Lint / Typecheck

```powershell
pnpm run format:check
pnpm run lint
pnpm run typecheck
```

Proves: the hand-written TypeScript across ~15 packages and 3 apps is
actually syntactically and type-correct against real `@types/*` and
library type definitions — this is the first point where import errors,
typos, or API-shape mistakes (e.g. wrong Prisma field name, wrong NestJS
decorator usage) would surface.
**If typecheck fails**: send back the exact `tsc` error output; it will
point at a specific file/line.

## 4. Database

```powershell
pnpm db:generate
pnpm db:migrate:dev
pnpm db:seed
```

Proves: `schema.prisma` is valid Prisma syntax, migrates cleanly against
real Postgres, and the seed script's Prisma calls match the generated
client's actual API.
**If migrate fails**: send back the Prisma error — likely a field/relation
naming issue that only Prisma's own validator catches.

## 5. Unit tests

```powershell
pnpm test:unit
```

Proves: every unit test file across all packages actually runs and passes
under real Vitest — including the finance/scoring/policy calculations that
were manually hand-traced during writing but never machine-verified until
now.
**Record**: pass count, fail count, and the first failing assertion if any.

## 6. Integration tests

```powershell
pnpm --filter @ventureos/api test:integration
```

Proves: the full Nest app boots, connects to real Postgres, and the
auth flow (login/logout/session/RBAC) works end to end against a real
database — not mocked.

## 7. Build

```powershell
pnpm build
```

Proves: `apps/web` (Next.js) and `apps/api` (NestJS) both produce a real
production build with no compilation errors.

## 8. Dev servers + E2E

```powershell
pnpm dev
# in a second terminal, once http://localhost:3000 responds:
pnpm --filter @ventureos/web test:e2e
```

Proves: the full stack (web + api + worker + postgres + temporal + minio)
works together, and the Playwright test can actually log in through a real
browser and see the real dashboard.

## 9. Temporal connectivity

```powershell
curl http://localhost:3001/api/health/temporal
```

Should return HTTP 200 with
`{"status":"ok","checks":{"temporal":{"status":"ok"}},...}`. This proves
only bounded, non-mutating Temporal server connectivity. It creates no workflow
history and does not prove worker or task-queue readiness. See
`docs/HEALTH_CHECKS.md` for monitoring expectations and the worker limitation.

## First error to report back if anything fails

Send: (1) which numbered step failed, (2) the exact command you ran, (3)
the full error output (not a summary/paraphrase), (4) `node --version`,
`pnpm --version`, `docker --version` output. That's enough to diagnose
without needing to reproduce your whole environment from scratch.
