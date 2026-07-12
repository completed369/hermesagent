# Deployment

## Local development (only target verified in this build)

Docker Compose (`docker-compose.yml` at repo root) runs PostgreSQL,
Temporal + Temporal UI, and MinIO. `apps/web`, `apps/api`, `apps/worker` run
as plain Node processes via `pnpm dev` (Turborepo parallel dev mode) —
not containerized in Phase 1. See `docs/LOCAL_SETUP_WINDOWS.md`.

## Future target: affordable European VPS / managed containers (master spec §4)

Not configured yet. When this is built, it must remain a *thin* layer over
the same Docker Compose services (or their managed equivalents) — no
enterprise-only products, usage-based/self-hosted preferred. Candidate
approach: Dockerfiles per app (not yet written) + a single European VPS
running the same `docker-compose.yml` plus a reverse proxy (Caddy/Traefik)
for TLS. Revisit once Phase 6 (marketplace pilot) needs a stable public URL
for webhook callbacks.

## Environments

`NODE_ENV` drives a few behavioral differences today (cookie `secure` flag,
Prisma log verbosity). A formal staging/production environment split with
separate `.env` files and separate databases is a Phase 6+ concern — Phase 1
only needs `development`.

## What must never happen automatically

No paid service activates automatically (`FEATURE_PAID_INTEGRATIONS_ENABLED=false`
default). No deployment step publishes externally, spends money, or changes
production configuration without founder approval — this is a process rule
until Phase 3's approval workflow can enforce it in code for deploy-time
actions too.
