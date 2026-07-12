# TODO

## Immediate (local verification, blocks calling Phase 1 "done")

- [ ] Run `.\scripts\preflight.ps1` and resolve any FAIL items
- [ ] `pnpm install` and confirm zero errors
- [ ] `docker compose up -d` and confirm all 4 services healthy
- [ ] `pnpm db:generate && pnpm db:migrate:dev && pnpm db:seed`
- [ ] `pnpm run format:check && pnpm run lint && pnpm run typecheck`
- [ ] `pnpm test:unit` (all packages) — record pass/fail counts
- [ ] `pnpm --filter @ventureos/api test:integration` — requires seeded DB
- [ ] `pnpm build` (all apps)
- [ ] `pnpm dev`, then `pnpm --filter @ventureos/web test:e2e`
- [ ] Report the first real error back per docs/LOCAL_VERIFICATION_CHECKLIST.md if anything fails

## Phase 2 (next, after Phase 1 is verified locally — do not start early)

- [ ] Opportunity + Evidence Prisma models and migrations
- [ ] Seed the "Social Media Content Planning Kit" opportunity (master spec section 25)
- [ ] Opportunity feed UI + comparison view
- [ ] Wire `@ventureos/scoring-engine` (already built, unit-tested) into a real Opportunity Score API endpoint
- [ ] Profit Confidence Score UI treatment (speculative labelling)

## Known follow-ups from Phase 1

- [ ] Extract `apps/web/src/components` into `@ventureos/ui` once a second consumer exists
- [ ] Multi-factor authentication (deferred per master spec section 8, architecture should anticipate it)
- [ ] Account recovery flow (password reset) — not implemented, dev-login only so far
- [ ] OpenTelemetry exporter wiring (currently `OTEL_ENABLED=false` stub only)
- [ ] CI workflow (`.github/workflows/ci.yml`) is written but unverified — needs a real run

See `docs/ROADMAP.md` for the full phase-by-phase plan and `docs/KNOWN_LIMITATIONS.md`
for a complete list of mocked/incomplete functionality.
