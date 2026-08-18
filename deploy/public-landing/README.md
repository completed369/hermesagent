# VentureOS public landing artifact

## Purpose

This directory contains the dedicated static public marketing/progress page for
`https://ventureos.site`.

It is intentionally limited to static HTML and CSS. It does not include the
private VentureOS application, authenticated screens, backend APIs, database,
Temporal worker, storage, analytics, external scripts, external fonts, cookies,
or provider integrations.

## Cloudflare Pages v1 deployment method

Target provider for the first public landing release: **Cloudflare Pages — Direct
Upload**.

Do not deploy from an automation token or Git integration for v1 unless a later
reviewed change explicitly replaces this runbook.

Future founder/operator steps, not executed by this repository change:

1. Open the Cloudflare Dashboard.
2. Open Workers & Pages.
3. Create application.
4. Choose Pages.
5. Choose Direct Upload / drag and drop.
6. Use the project name `ventureos-public`.
7. Upload only the contents of `deploy/public-landing/` for the reviewed public
   landing artifact.
8. First verify the generated `*.pages.dev` URL.
9. Verify these paths before attaching the custom domain:
   - `/`
   - `/404-test`
   - `/dashboard`
   - `/api/health/live`
10. Only after validation, attach `ventureos.site`.
11. Optionally attach `www.ventureos.site`.
12. Verify HTTPS and the response security headers.
13. Record the Cloudflare Pages deployment ID/version in the issue or release
    evidence.

Expected route behavior for this static artifact:

- `/` serves the public landing page.
- Unknown paths serve the static 404 page.
- Private application routes and backend-style paths must not expose VentureOS
  application functionality.

## Rollback

Use Cloudflare Pages' previous known-good deployment / rollback controls before
changing DNS further. If custom-domain attachment causes unexpected behavior,
rollback to the prior Pages deployment or remove the custom-domain attachment
according to Cloudflare's audited dashboard controls.

## Boundary statement

The private VentureOS app is **not** part of this deployment. Private staging,
VPS deployment templates, image publication workflows, backend APIs, databases,
Temporal, worker processes, storage, and authenticated product surfaces remain
separate and must not be exposed by this public landing artifact.
