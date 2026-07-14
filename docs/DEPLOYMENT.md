# Deployment

## Local development (only target verified in this build)

Docker Compose (`docker-compose.yml` at repo root) runs PostgreSQL,
Temporal + Temporal UI, and MinIO. `apps/web`, `apps/api`, `apps/worker` run
as plain Node processes via `pnpm dev` (Turborepo parallel dev mode) —
not containerized in Phase 1. See `docs/LOCAL_SETUP_WINDOWS.md`.

## Future target: affordable European VPS / managed containers (master spec §4)

Not configured yet. When this is built, it must remain a _thin_ layer over
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

## Multi-tenant deployment topology (Phase 8)

Phase 8 does not change the deployment shape above — it is still one
Postgres instance, one Temporal instance, one MinIO instance, and the same
three app processes (`web`/`api`/`worker`). What changes is that a single
running instance can now serve **multiple independent workspaces** rather
than only the one founder workspace the seed script creates:

- **Tenant boundary**: `Workspace` has always been the isolation boundary
  (every table hangs off `workspaceId`, per `docs/ARCHITECTURE.md`); Phase 8
  just adds a real way to create a _second_ workspace — `POST
/api/auth/register` — instead of only ever having the one seeded founder
  workspace. No new isolation mechanism was needed because the schema was
  already built this way from Phase 1 onward.
- **Plans and subscriptions**: every workspace gets exactly one
  `Subscription` row (TRIAL by default for a new registration, or whatever
  plan an operator manually assigns via `changePlan`). Plan limits
  (`maxVentures`/`maxWorkspaceMembers`/`maxMarketplaceAccounts`) are
  enforced by `@ventureos/billing`'s guard functions before the relevant
  create-path runs.
- **White-label**: `WorkspaceBranding` lets each workspace show its own
  brand name/logo/accent color in the dashboard shell — this is a per-tenant
  cosmetic setting, not a separate deployment or subdomain. Multi-domain/
  custom-domain white-labeling (e.g. `app.customerdomain.com`) is explicitly
  **not** built — that would require reverse-proxy/TLS/DNS work that is out
  of scope until there is a real second customer asking for it.
- **License keys**: `LicenseKey` exists for a genuinely _separate_,
  self-hosted install (a customer running their own Docker Compose stack
  entirely, not a workspace on this shared instance) to validate itself
  against — see "Exportable/self-hosted installs" below. It has no bearing
  on tenant isolation for workspaces sharing this instance.

### Exportable/self-hosted installs

A customer who wants to run their _own_ fully separate instance (their own
Postgres/Temporal/MinIO, their own domain) rather than a workspace on a
shared instance needs:

1. This repository, cloned.
2. Their own `.env` (from `.env.example`) with a `DEV_FOUNDER_EMAIL`/
   `DEV_FOUNDER_PASSWORD` for their own first login (or, once registration
   is enabled in their environment, they simply register the first
   workspace themselves).
3. `docker compose up -d`, `pnpm install`, `pnpm db:migrate:deploy`,
   `pnpm db:seed` (seeds the plan tiers + a founder workspace exactly as
   this reference install does).
4. A `LicenseKey` issued from **this** reference instance (Settings →
   License keys → Issue license key) for tracking which self-hosted
   installs exist — the exported install does not currently call home to
   validate the key automatically (that would require a licensing-server
   endpoint this phase does not build); the key is presently a record-
   keeping mechanism, not an enforced runtime gate on the exported install
   itself. Wiring a real "phone home" validation check is future work once
   there is a real second self-hosted customer to design it against.

See `docs/CUSTOMER_GETTING_STARTED.md` for the customer-facing version of
this walkthrough (written for someone who is not a VentureOS developer).
