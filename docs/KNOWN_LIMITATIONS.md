# Known Limitations

## Sandbox-imposed (not a code problem — see SANDBOX_LIMITATIONS.md)

Nothing in this repository has been installed, compiled, migrated, seeded,
started, or tested. All "implemented" claims in this documentation mean
"real source code exists and was manually/structurally reviewed" — not
"verified working." Local verification is required before any acceptance
criterion can be honestly marked complete; see LOCAL_VERIFICATION_CHECKLIST.md.

## Code-level gaps, honestly disclosed

- **Session tokens stored as plaintext** in the DB (unique-indexed, not
  hashed-at-rest). Fine for single-founder dev; must be hardened
  (hash-and-compare) before any multi-user or production deployment.
- **No CSRF token**: relies on `sameSite=lax` cookie + CORS origin allowlist
  only. Adequate for local dev, not a complete CSRF defense.
- **No login-attempt lockout**: only the global rate limiter throttles
  repeated login attempts; no per-account/per-IP brute-force lockout yet.
- **No dependency scanning has ever run** against this repository (no
  network access in the build sandbox) — the `pnpm-lock.yaml` does not even
  exist yet, so exact resolved versions (and any known CVEs in them) are
  unknown until `pnpm install` runs locally.
- **Prisma migrations have not been generated.** The schema
  (`schema.prisma`) is hand-written and believed correct but has never been
  run through `prisma migrate dev` against a real Postgres instance, so
  subtle issues (e.g. enum vs. string choices, index naming collisions)
  could surface on first real migration.
- **MinIO/Temporal/Postgres connectivity code has never executed.** Client
  configuration (ports, bucket names, connection strings) is believed
  correct based on each library's documented API but is unverified.
- **CI workflow is unverified** — written to a reasonable GitHub Actions
  shape but has never actually run.
- **Playwright browsers are not installed** in this sandbox; the e2e test
  file has never executed even once, not even to confirm it parses/compiles
  correctly under the real Playwright test runner.
- **No malware scanning** on uploaded files (integration point documented,
  not wired).
- **No OpenTelemetry exporter** wired despite `OTEL_*` env vars existing —
  currently a structural placeholder only.

## Scope limitations (by design, not oversight)

Everything Phase 2 and later (Opportunity/Evidence/Board/Approval/Product/
Listing/Finance/Experiments/Marketplace-live/Multi-venture) is intentionally
absent — see `ROADMAP.md`.
