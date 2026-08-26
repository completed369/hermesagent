# Commercial Validation Gates

## Issue #31 / #42 preparation snapshot — 2026-08-26

Status: **PREPARED / BLOCKED**. The source-controlled pet-sitting operations candidate's selected
input fields are compatible with the evaluated subset of the Etsy development-pack source, and the
deterministic opportunity formula produces `76.95`. The subset covers marketplace/product type,
restricted-category and declared-IP inputs, plus title length; it does not evaluate the full listing,
image, file, pricing, publication, account or live policy state. This is an offline readiness result,
not a Gate 1 or Gate 2 pass.

The offline preflight validates the strict current input schema, evaluated source-input subset
compatibility, deterministic opportunity scoring and evidence-expiry horizon. Its output is
sanitized and cannot
persist an opportunity, dispatch work, contact a prospect, activate a provider or decide an
approval. Authoritative policy-pack active/review state, workspace title uniqueness, server-derived
evidence/profit scores, board review and persisted Founder approval remain unresolved. The current
application release is neither published nor deployed to private product staging, so execution of
the commercial pilot remains behind the existing Founder/deployment boundary.

`docs/COMMERCIAL_PILOT_LOG.md` therefore remains **NOT STARTED**. Issue #31 preparation does not
create a customer or design partner, and Issue #42 preparation does not execute either commercial
gate.

After the repository dependencies are installed, the fixed offline check is available as
`pnpm --filter @ventureos/api run stage6:pilot-preflight`. The command generates the local Prisma
client and builds its workspace dependencies before running; it does not connect to a database. It
accepts no alternate path or customer input and emits only the sanitized decision packet.
The runner rejects any change to the reviewed fixture digest and takes its evaluation time from the
process clock; only the pure test seam accepts an injected date.

Per master spec section 30. The six gate definitions and thresholds below are authoritative. The underlying opportunity, board, approval, product, listing, finance and experiment mechanisms now exist; Stage 6 must exercise them against one real pilot venture rather than treating seeded/demo data as commercial evidence.

| Gate                      | Key thresholds                                                                                                                              | Current readiness                                                                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Problem Validation     | Defined customer + problem, evidence records, no critical compliance blocker                                                                | Mechanically ready for a fresh Stage-6 pilot: founder intake, evidence records and the deterministic `opportunity-compliance-v1` assessment are implemented and auditable.                      |
| 2. Opportunity Validation | Opportunity score ≥70, Profit Confidence ≥70, evidence quality ≥70, board weighted approval ≥75%, no active critical veto, founder approval | Mechanically ready for fresh Stage-6 opportunities: all three scores are versioned/persisted, evidence quality is wired into board voting, and founder approval remains independently required. |
| 3. Product Validation     | Complete package, QA passed, licences complete, hashes recorded, founder approval                                                           | Mechanically reachable through Product Studio/QA and Founder Approval; must be exercised on the chosen pilot product.                                                                           |
| 4. Listing Validation     | Marketplace policy checks passed, pricing validated, preview complete, founder approval                                                     | Mechanically reachable through Listing Studio/SEO/policy checks and Founder Approval; must be exercised on the chosen pilot listing.                                                            |
| 5. Commercial Validation  | Impressions/conversion/refund-rate/margin/support-load metrics                                                                              | Gate mechanics can be recorded with mock adapters, but a genuine pass requires real marketplace/customer signal. Mock metrics must never be presented as real commercial validation.            |
| 6. Scale Decision         | Positive unit economics, acceptable refund/quality/support, improving forecast accuracy, founder approval for spend increase                | Scale-decision machinery exists and is founder-gated; a genuine Stage-6 pass requires real pilot economics/quality/support evidence rather than seeded/demo numbers.                            |

## Stage 6 execution rules

- Use **one real pilot opportunity**. The seeded `Social Media Content Planning Kit` fixture may remain a demo/reference but does not count as the required real pilot unless the founder explicitly chooses that exact opportunity and supplies real validation evidence for it.
- Gates 1-4 must be supported by real pilot evidence and genuine founder decisions at the existing approval checkpoints.
- Gate 5 must be labelled **mechanical/mock only** unless real marketplace/customer metrics are actually collected.
- Gate 6 must not approve increased spend from synthetic or seeded economics.
- Every founder approval must be recorded by its persisted `ApprovalRequest`/decision evidence; no chat statement or agent memory substitutes for an approval record.
- Memory is advisory context only. It cannot grant, revoke or substitute for approval authority, policy checks, current business state or commercial evidence.

### Commercial observation provenance

Experiment results used for genuine Gate 5/6 evidence must be explicitly recorded as `REAL` with a non-synthetic source type, source reference and observation timestamp. Unspecified and historical experiment results default to `MOCK`/`SYNTHETIC`; they may prove workflow mechanics but cannot satisfy genuine commercial-validation or scale-evidence claims. Provenance is persisted separately from the numeric result and is included in the scale-approval artifact hash, so changing the evidence set invalidates an older scale authorization. Gate 5 support load has explicit `SUPPORT_CONTACTS`, `SUPPORT_MINUTES` and `QUALITY_INCIDENTS` metric names rather than being hidden under `OTHER`.

## Implemented Stage 6 prerequisite: fresh opportunity intake

The release before Stage 6 had no supported product/API path for creating a fresh non-seed opportunity. Stage 6 now adds one:

- `POST /api/opportunities` requires `opportunity:manage`, validates all input server-side and creates the Opportunity, target customer, optional channel, initial evidence, EvidenceClaim records and initial score history atomically.
- the Opportunity Feed links to `/dashboard/opportunities/new`, a founder-facing intake form that requires customer/problem/evidence inputs and normalized score-factor inputs rather than fabricating a candidate automatically;
- evidence source type/retrieval metadata are founder-entered, while reliability and freshness are derived by the server using the existing research-connector scoring functions;
- final Opportunity Score, Profit Confidence, Evidence Quality and data freshness cannot be supplied as arbitrary client values;
- the creation action and later rescoring action are appended to the audit trail;
- `POST /api/opportunities/:id/rescore` appends reproducible score history only while the opportunity is `NEW` or `UNDER_REVIEW`; scores are frozen after promotion/terminal state;
- real-Postgres integration coverage proves creation, workspace isolation, score history, rescoring, promotion and board evidence-gate consumption;
- Chromium E2E coverage proves founder login -> Opportunity Feed -> New opportunity -> POST create -> new detail page, including visible Evidence Quality/version.

This implementation makes intake mechanically available. It does **not** choose the founder's commercial pilot or fabricate real market evidence.

## Implemented Stage 6 prerequisite: opportunity-level evidence quality

Gate 2 requires a standalone `evidence quality >=70` result. The master specification defines that threshold but not an aggregation formula, so ADR-012 records the project decision before the result is used as a commercial gate.

Formula `opportunity-evidence-quality-v1` is implemented in `packages/policy-engine/src/evidence-quality.ts`:

`artifact quality = reliability * 0.50 + relevance * 0.30 + freshness * 0.20`

The opportunity result is the mean of unique linked artifact scores. Claim count cannot inflate one source's weight; explicitly expired artifacts stay in the denominator with zero contribution; missing evidence produces no numeric score and fails closed. Tests cover the exact 70 boundary, below-threshold low reliability, mixed-quality evidence, duplicate-source de-duplication, expired/stale evidence, missing evidence and invalid dimensions.

`packages/database/src/opportunity-scoring.ts` persists the aggregate as `OpportunityScore.scoreType = EVIDENCE_QUALITY`, including formula version and component provenance, and injects server-derived evidence quality/data freshness into the existing Profit Confidence calculation in the same transaction.

`runBoardReview` now loads the latest persisted `EVIDENCE_QUALITY` result for Stage-6-created opportunities and supplies it to the existing `calculateBoardVotingResult` rule. A score below 70 therefore blocks the board independently of weighted approval. Legacy seed/demo opportunities that predate this history retain their old mechanical regression behavior and do not count as Stage-6 commercial proof.

## Implemented Stage 6 prerequisite: Gate-1 compliance blocker

Gate 1 now has authoritative evidence independent of the mock Compliance agent. Formula `opportunity-compliance-v1` is implemented in `packages/policy-engine/src/opportunity-compliance.ts` and evaluates explicit founder declarations against the current marketplace policy pack plus linked opportunity evidence.

The assessment fails closed when required context is absent or invalid. It blocks missing/mismatched/inactive/expired policy packs, missing or unsupported product types, missing or restricted category declarations, declared third-party trademarks that conflict with the current IP check, declared unlicensed copyrighted stock content, and missing evidence.

`GET /api/opportunities/:id/compliance-assessment` returns the current assessment state. `POST /api/opportunities/:id/compliance-assessment` requires `opportunity:manage`, validates the declarations server-side and appends an `OPPORTUNITY_COMPLIANCE_ASSESSED` AuditEvent containing the formula version, blocker result, selected evidence IDs, policy-pack version and a hash of the opportunity/evidence/policy state used for the decision.

For fresh Stage-6 opportunities, promotion now requires a current passing Gate-1 assessment. Any later change to the opportunity, linked evidence or marketplace policy state makes the stored assessment stale and blocks promotion until reassessed. The founder-facing opportunity detail UI exposes the assessment, blockers, formula/policy-pack version and audit evidence. Integration and Chromium E2E coverage prove missing -> blocked -> passing assessment behavior and compliant promotion.

The structured board-veto system remains independent: a later active Compliance BoardVeto still blocks Gate 2 regardless of the earlier Gate-1 result.

## Stage 6 readiness boundary

The implementation prerequisites tracked in Issue #24 are complete. VentureOS is now mechanically ready to begin a genuine Stage-6 pilot through Gates 1-4 without using seeded/demo data as proof.

The next boundary is commercial, not technical: the founder must choose the actual pilot opportunity and provide or authorize the real evidence/market signal used to validate it. VentureOS must not auto-select a commercial venture, fabricate evidence, enable real marketplace writes, incur paid provider spend or enable advertising merely because the software path is ready.

**Rule enforced from day one**: do not scale paid advertising before low-cost validation — `FEATURE_ADVERTISING_ENABLED=false` by default and requires explicit founder action to change.

Stage-6 evidence belongs in `docs/COMMERCIAL_PILOT_LOG.md`.
