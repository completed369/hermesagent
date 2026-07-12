# VentureOS

**Human-Controlled AI Business Operating System.**

VentureOS lets one founder research, validate, create, launch and operate
digital businesses using a controlled team of AI agents — with the founder
holding final authority over every spend, publication, and irreversible
action. See `PROJECT_CONTEXT.md` for the full mission and `docs/ROADMAP.md`
for the phased delivery plan.

**Current status: Phase 0 (environment/repo) and Phase 1 (foundation) source
code complete. Not yet installed, built, or run — see
[docs/SANDBOX_LIMITATIONS.md](docs/SANDBOX_LIMITATIONS.md) and
[docs/LOCAL_VERIFICATION_CHECKLIST.md](docs/LOCAL_VERIFICATION_CHECKLIST.md).**

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

Opportunity feed, evidence system, AI board of agents, approval workflow UI,
product/listing studios, finance dashboards, marketplace publishing — all
Phase 2+ (see `docs/ROADMAP.md`). Their nav entries exist in the dashboard
shell but are greyed out and labelled by phase.

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

## Why nothing has been installed, built, or tested yet

This repository was generated in a sandboxed environment with **no Docker**
and **no outbound network access** (npm/PyPI/GitHub/Docker Hub all blocked).
Every file here is real, hand-written source — not generator boilerplate —
but none of it has been through `pnpm install`, a compiler, or a test
runner. Full details: [docs/SANDBOX_LIMITATIONS.md](docs/SANDBOX_LIMITATIONS.md).

## License

Proprietary / unlicensed. Founder: Yiannis.
