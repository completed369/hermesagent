# Deployment

## Current-state note

This document reconciles deployment terminology across repository source,
validation evidence, staging-gate configuration, private-staging templates, and
external operational state. It does not claim that any deployment was performed
during this documentation-only reconciliation.

### Verified product snapshot (2026-08-25)

- Product `main` is `1cdf560dcd9bb8e824fa3bf2b82846ff4c3f1675`.
- Exact-main CI passed migrations, integration, production build, Chromium E2E,
  and the disposable staging-security/load gate. The gate is explicitly no-
  deploy validation.
- Exact-main CodeQL passed; zero CodeQL alerts were open when checked on
  2026-08-25.
- The sanitized release-candidate workflow built and scanned five runner-local
  image archives, validated local SBOM and source identity, uploaded zero
  artifacts, and created zero deployments.
- No image for current product `main` has been published. Current product
  `main` has not been deployed to private staging. Historical publication and
  private-staging evidence belongs to an older product baseline, not current
  `main`.

### Dated operations snapshot (non-authoritative)

As checked on 2026-08-25, operations PR #24 had deployed the Access-protected
Founder Mission Control, and its deployment, command-center, and Site Steward
checks were green. That deployment is the protected progress site, not the
product application, API staging, image registry, or production. Private
operations evidence and the live Cloudflare Access boundary are authoritative
for current state; this dated snapshot must not be treated as a mutable cross-
repository pin.

## Deployment-state taxonomy

Use these terms precisely:

1. **Repository source/configuration state** — files exist in this repository,
   such as Compose files, Dockerfiles, scripts, or GitHub workflows.
2. **Local development validation evidence** — commands were run on a developer
   machine and recorded elsewhere, usually against local Docker infrastructure.
3. **GitHub CI evidence** — GitHub Actions workflow runs for a specific ref.
4. **Local/container staging-gate evidence** — the reproducible local/container
   production-mode, mock-only proof in `docker-compose.staging.yml` and
   `scripts/staging-security-gate.sh all`.
5. **Private-staging deployment capability/templates** — deployment templates,
   scripts, and protected/manual workflows exist for a founder-authorized private
   staging deployment path.
6. **Externally verified staging deployment state** — separately observed
   operational evidence from an external staging environment, if any.
7. **Production deployment state** — separately observed production operational
   evidence and approval.

The repository contains private-staging deployment configuration and workflows.
Repository evidence alone does not establish the current operational state of any
externally deployed staging environment. It also does not establish production
deployment state or production readiness.

## Local development

Docker Compose (`docker-compose.yml` at repo root) runs PostgreSQL, Temporal +
Temporal UI, and MinIO for local development. `apps/web`, `apps/api`, and
`apps/worker` run as Node processes via `pnpm dev` unless a different local
command is explicitly used. See `docs/LOCAL_SETUP_WINDOWS.md`.

Local development validation evidence is historical/run-specific. Consult
`docs/EXECUTION_PLAN.md`, `docs/TECHNICAL_RELEASE_BASELINE.md`, and
`docs/APPLICATION_SECURITY_BASELINE.md` for recorded command evidence rather
than assuming the current working copy has been rerun.

## GitHub CI validation

`.github/workflows/ci.yml` is validation-only. It runs clean-runner checks and a
local/container staging security gate, but it does not deploy externally, publish
marketplace content, activate paid services, contact real providers, or change
production configuration. See `docs/CI_GOVERNANCE.md`.

## Local/container staging gate

`docker-compose.staging.yml`, `Dockerfile.staging`,
`scripts/generate-staging-env.mjs`, and `scripts/staging-security-gate.sh`
define a reproducible local/container staging proof. It runs application
containers in production mode with synthetic credentials, mock providers, loopback
relays, and fail-closed live/paid feature switches. See
`docs/STAGING_SECURITY_GATE.md`.

This is local/container evidence only. It is not public ingress, TLS, cloud,
host-hardening, backup/restore, real-provider, external staging deployment, or
production evidence.

## Private-staging deployment capability/templates

The repository also contains a private-staging deployment template under
`deploy/private-staging/` and manually dispatched workflows such as:

- `.github/workflows/publish-images.yml`
- `.github/workflows/private-staging-connectivity.yml`
- `.github/workflows/private-staging-deploy.yml`

These files represent configured capability/templates for a founder-authorized
private-staging deployment path. They include authorization phrases,
protected-environment assumptions, immutable image/digest expectations, secret
file boundaries, and a private tunnel topology. Their presence does not prove
that images have been published, that credentials/settings exist in GitHub, that
a VPS or tunnel is reachable, or that an external staging environment is
currently deployed.

Image publication is bound to the exact commit of the protected branch from
which the manual workflow is dispatched (`github.sha`). The workflow does not
accept an operator-supplied checkout reference; the separately configured
approved SHA must match that protected-branch commit before any source is
checked out or executed.

Externally verified staging state must come from separate operational evidence,
not from repository files alone.

## Production deployment state

Production deployment is not established by repository evidence alone. A
production launch would require founder approval plus evidence for the selected
provider/region, TLS/ingress, secret manager, database/storage/Temporal
persistence, backup/restore, monitoring/alerting, rollback, repository
protections, and legal/commercial readiness.

No deployment step may automatically spend money, publish externally, send
customer-facing messages, accept agreements, access financial accounts, disable
security controls, or bypass founder approval.

## Provider and commercial-action gates

Real AI providers, live Etsy publication, payments, advertising, email,
notifications, customer communication, and other sensitive external actions
remain mock/disabled/gated unless a future founder-approved scope supplies the
credentials, deterministic backend controls, provider-specific safeguards, and
validation evidence.

Repository configuration may contain placeholders or templates for future
provider wiring. That is not the same as live provider capability or production
readiness.

## Multi-tenant deployment topology

Phase 8 introduced multi-workspace/SaaS-oriented application capability, but it
does not require microservices. A shared instance can serve multiple workspaces
through the `Workspace` tenant boundary, subscription/plan rows, quota guards,
and per-workspace branding. Custom domains, multi-domain white-labeling, and
customer-specific external infrastructure require additional ingress/TLS/DNS and
operational design.

## Exportable/self-hosted installs

A customer or operator running a separate self-hosted instance would need this
repository, their own environment/secrets, infrastructure, migrations, seed or
bootstrap process, and operational controls. License keys exist as a
record-keeping mechanism in the current application; repository evidence does
not establish an enforced phone-home licensing service.

See `docs/CUSTOMER_GETTING_STARTED.md` for the customer-facing local/self-hosted
walkthrough.
