# Contributing to VentureOS

`package.json` currently declares this repository `UNLICENSED`. No public
license grant, contributor license agreement, contribution-rights transfer, or
external contribution process is evidenced. Do not solicit or accept an
external contribution until the Founder establishes the applicable terms with
qualified legal review where appropriate.

## Before changing source

- Work from the exact intended base and keep unrelated user changes intact.
- Use an isolated branch or worktree for concurrent work.
- Never commit credentials, personal data, customer data, confidential reports,
  local environment files, or sensitive infrastructure details.
- Keep raw local logs and transcripts out of Git; preserve reviewed facts under
  the [historical evidence policy](docs/HISTORICAL_EVIDENCE_POLICY.md).
- Do not enable providers, spending, publication, deployment, DNS, or production
  mutations in a routine code change.
- Preserve workspace scoping, server-side authorization, audit atomicity,
  approval boundaries, and fail-closed production composition.

## Validation

Use Node.js 22 or later and the pinned pnpm version. A normal source change is
expected to pass the applicable subset of:

```text
pnpm install --frozen-lockfile
pnpm run format:check
pnpm run repository:artifact-hygiene
pnpm run lint
pnpm run typecheck
pnpm db:generate
pnpm test:unit
pnpm test:integration
pnpm run build
pnpm test:e2e
pnpm docs:api:check
git diff --check
```

Database and browser checks require the documented disposable PostgreSQL and
Chromium test dependencies. Authoritative merge gates run on clean GitHub
runners. Do not weaken a test or policy to obtain a green result.

## Pull requests

Describe the exact scope, security and privacy impact, evidence run, known
limitations, rollback, and whether merge has any deployment/publication effect.
Generated API inventory changes must accompany controller-route changes. Keep
`MERGED`, `PUBLISHED`, `DEPLOYED`, and `VERIFIED` as distinct states.

Report vulnerabilities through [`SECURITY.md`](SECURITY.md), not a public pull
request.
