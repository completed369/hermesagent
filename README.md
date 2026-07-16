# VentureOS

**Human-Controlled AI Business Operating System.**

VentureOS lets one founder research, validate, create, launch and operate
digital businesses using a controlled team of AI agents — with the founder
holding final authority over every spend, publication, and irreversible
action. See `PROJECT_CONTEXT.md` for the full mission and `docs/ROADMAP.md`
for the phased delivery plan.

**Current status: verified LOCAL DEVELOPMENT build. All numbered internal
phases 0–8 are committed and validation-green — the full six-stage suite
(format, lint, typecheck, unit, integration, build) passes, and the
Playwright login/dashboard e2e suite passes 4/4. This is NOT a production
deployment: real AI provider calls, live Etsy publishing, real payments, and
advertising spend all remain disabled/pending, and founder approval remains
mandatory for every sensitive action. See
[docs/EXECUTION_PLAN.md](docs/EXECUTION_PLAN.md) (canonical status),
[docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md), and
[docs/SANDBOX_LIMITATIONS.md](docs/SANDBOX_LIMITATIONS.md) for the historical
sandbox context in which the code was first authored.**

## What's implemented in Phase 1

- Founder authentication (email/password, hashed with scrypt, server-side sessions)
- Workspace + role-based access control (RBAC), enforced server-side on every route
- Founder onboarding (save/load business goals, budget, risk tolerance, etc.)
- Append-only, integrity-hashed audit event trail
- Security event log (login attempts, etc.)
- Health endpoints (liveness, readiness incl. DB + MinIO checks, Temporal connectivity check)
- Structured JSON logging with request correlation IDs
- Rate limiting, safe (non-leaking) error responses, environment validation that fails closed
- MinIO-backed object storage abstraction (MIME/size/path-traversal validation)
- A minimal Temporal worker + workflow proving durable workflow execution end to end
- Deterministic finance, opportunity-scoring, and policy engines with unit tests
  (built ahead of schedule as shared, framework-agnostic packages so Phase 2/3
  can consume them without rewrites — see `docs/ROADMAP.md`)

## What's explicitly NOT implemented yet

The numbered internal implementation phases 0–8 (opportunity feed, evidence system, AI board of
agents, approval workflow, product/listing studio, research connectors,
marketplace pilot, finance/analytics, multi-venture SaaS) are all built and
their nav entries are live. What remains deliberately mock-only or pending —
by founder decision, not omission — is: real AI model calls (`AI_PROVIDER=mock`),
live Etsy publishing (ADR-007, mock-only), real payment processing (ADR-010,
mock-only), advertising spend, and any staging/production deployment. These
stay disabled until the founder explicitly authorises them. See
`docs/ROADMAP.md`, `docs/DECISIONS.md`, and `docs/KNOWN_LIMITATIONS.md`.

## Repository layout

```
apps/web       Next.js founder dashboard
apps/api       NestJS REST API
apps/worker    Temporal worker
packages/      Shared libraries (see each package's README/comments)
infrastructure/ Docker/scripts (currently just docker-compose.yml at repo root)
docs/          All required project documentation
scripts/       Windows PowerShell helper scripts for local setup/run/verify
```

## Quick start (Windows 11 + PowerShell 7 + Docker Desktop)

See **[docs/LOCAL_SETUP_WINDOWS.md](docs/LOCAL_SETUP_WINDOWS.md)** for full
prerequisites and troubleshooting. Short version:

```powershell
cd D:\Projects\ventureos   # or wherever you placed this repo
.\scripts\preflight.ps1
.\scripts\setup-local.ps1
.\scripts\start-infrastructure.ps1
.\scripts\start-development.ps1
```

Then open http://localhost:3000, sign in with the seeded founder account
(email/password from your local `.env`), and see
[docs/LOCAL_VERIFICATION_CHECKLIST.md](docs/LOCAL_VERIFICATION_CHECKLIST.md)
to confirm every Phase 1 acceptance criterion locally.

## Historical note: the original sandbox authoring environment

This repository was first generated in a sandboxed environment with **no
Docker** and **no outbound network access** (npm/PyPI/GitHub/Docker Hub all
blocked), so the initial commits were hand-written source that had never been
through `pnpm install`, a compiler, or a test runner. That is no longer the
current state: the code has since been installed, migrated, seeded, built,
and validated locally (see `docs/EXECUTION_PLAN.md`). This section is kept for
historical context — full details: [docs/SANDBOX_LIMITATIONS.md](docs/SANDBOX_LIMITATIONS.md).

## License

Proprietary / unlicensed. Founder: Yiannis.
