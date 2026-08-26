# VentureOS

**Human-Controlled AI Business Operating System.**

VentureOS lets one founder research, validate, create, launch and operate
digital businesses using a controlled team of AI agents — with the founder
holding final authority over every spend, publication, and irreversible
action. See `PROJECT_CONTEXT.md` for the full mission and `docs/ROADMAP.md`
for the phased delivery plan.

**Verified repository status (dated reviewed source baseline: 2026-08-26).**
The application has a green clean-runner CI baseline covering formatting,
linting, typechecking, Prisma migrations, unit and PostgreSQL integration tests,
production builds, and Chromium E2E. CodeQL reported no open alerts at review
time. Collaboration and the service-only Agent Control Plane foundations are
merged. Codex, Hermes, and Pi remain `NOT_CONFIGURED`: no authenticated runtime
round trip has been established. This source review is not a production,
publication, private-staging, customer, or commercial-launch claim. Real AI
providers, live marketplace publication, payment processing, and advertising
remain disabled or unavailable, and consequential actions remain governed. See
[docs/EXECUTION_PLAN.md](docs/EXECUTION_PLAN.md) (canonical status),
[docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md), and
[docs/RELEASE_READINESS_2026-08-26.md](docs/RELEASE_READINESS_2026-08-26.md).
GitHub checks and protected operational evidence are authoritative for mutable
current state.**

## Implemented foundations

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
- Collaboration with active-workspace switching, invitation acceptance,
  membership management, role enforcement, and tenant-scoped session handling
- Durable, workspace-scoped Agent Control Plane objectives, projects, tasks,
  dependencies, runs, artifacts, approvals, broker reservations, bridge
  admission evidence, scoped secret leases, supervision policy, and audit/usage
  evidence — without claiming a connected or executing production runtime

## Explicit boundaries

Repository source implements the numbered venture workflow and later governed
workforce foundations. Source presence does not establish that a feature is
published, deployed, connected to a provider, or available to customers. Real
AI model calls (`AI_PROVIDER=mock`), live Etsy publishing (ADR-007, mock-only),
real payment processing (ADR-010, mock-only), advertising spend, production
runtime launching, and authenticated Codex/Hermes/Pi connections remain absent
or disabled. See
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

## Licensing status

`package.json` currently declares `UNLICENSED`. No public license grant or
external contribution terms are evidenced. Licensing and contribution-rights
decisions require Founder review and, where appropriate, qualified counsel. See
[CONTRIBUTING.md](CONTRIBUTING.md).
