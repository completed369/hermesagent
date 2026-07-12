# Roadmap

Phased delivery per master spec section 34. **Current run delivered Phase 0
and Phase 1 source code only** (section 35: "Begin with Phase 0 and Phase 1
only"). Phase 2 has not been started.

- **Phase 0 — Environment and Repository**: DONE (this run)
- **Phase 1 — Foundation**: DONE (this run) — auth, workspace, RBAC, audit,
  dashboard shell, seed, health, CI config, local security controls
- **Phase 2 — Opportunity and Evidence**: NEXT. Opportunity/Evidence Prisma
  models, seeded pilot opportunity (master spec §25 — Social Media Content
  Planning Kit), opportunity feed UI, wire `scoring-engine` to real data
- **Phase 3 — Board and Approval**: agent definitions + mock provider, board
  reviews using `@ventureos/contracts`/`policy-engine` (already built),
  Approval Centre, hash-bound approvals via `isApprovalValidForExecution`
  (already built), the real Temporal Opportunity-to-Product workflow
- **Phase 4 — Product and Listing Studio**: product/listing models, mock
  generation, Etsy dev policy pack, QA checks, licence records
- **Phase 5 — Research Connectors**: real (permitted) data acquisition
  contracts, evidence freshness/reliability, prompt-injection filtering
- **Phase 6 — Marketplace Pilot**: real marketplace integration ONLY after
  founder approval; draft listing creation; explicit publication approval
- **Phase 7 — Finance and Analytics**: forecasts vs. actuals, budget
  controls, experiments, performance dashboards
- **Phase 8 — Multi-Venture and SaaS**: multi-tenant isolation, white-label
  settings, licensing, exportable configuration

## Immediate next 5 tasks (start of Phase 2)

1. Local verification of Phase 1 (install, build, migrate, seed, test — see
   `LOCAL_VERIFICATION_CHECKLIST.md`) before writing new code
2. `Opportunity`, `OpportunityScore`, `TargetCustomer` Prisma models +
   migration
3. Seed script addition: the "Social Media Content Planning Kit" opportunity
   (master spec §25)
4. Opportunity feed page (`apps/web`) + `GET /api/opportunities` endpoint
   wired to the already-built `@ventureos/scoring-engine`
5. `EvidenceArtifact` model + a minimal evidence-attachment UI so opportunity
   score inputs have a real provenance trail from day one
