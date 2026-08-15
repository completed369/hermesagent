# Commercial Validation Gates

Per master spec section 30. The six gate definitions and thresholds below are authoritative. The underlying opportunity, board, approval, product, listing, finance and experiment mechanisms now exist; Stage 6 must exercise them against one real pilot venture rather than treating seeded/demo data as commercial evidence.

| Gate                      | Key thresholds                                                                                                                              | Current readiness                                                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Problem Validation     | Defined customer + problem, evidence records, no critical compliance blocker                                                                | Partially reachable. Fresh opportunity/customer/evidence intake now exists, but a genuine pilot still needs the authoritative compliance-blocker assessment described below.              |
| 2. Opportunity Validation | Opportunity score ≥70, Profit Confidence ≥70, evidence quality ≥70, board weighted approval ≥75%, no active critical veto, founder approval | Mechanically ready for fresh Stage-6 opportunities: all three scores are versioned/persisted, evidence quality is wired into board voting, and founder approval remains independently required. |
| 3. Product Validation     | Complete package, QA passed, licences complete, hashes recorded, founder approval                                                           | Mechanically reachable through Product Studio/QA and Founder Approval; must be exercised on the chosen pilot product.                                                                     |
| 4. Listing Validation     | Marketplace policy checks passed, pricing validated, preview complete, founder approval                                                     | Mechanically reachable through Listing Studio/SEO/policy checks and Founder Approval; must be exercised on the chosen pilot listing.                                                      |
| 5. Commercial Validation  | Impressions/conversion/refund-rate/margin/support-load metrics                                                                              | Gate mechanics can be recorded with mock adapters, but a genuine pass requires real marketplace/customer signal. Mock metrics must never be presented as real commercial validation.      |
| 6. Scale Decision         | Positive unit economics, acceptable refund/quality/support, improving forecast accuracy, founder approval for spend increase                | Scale-decision machinery exists and is founder-gated; a genuine Stage-6 pass requires real pilot economics/quality/support evidence rather than seeded/demo numbers.                      |

## Stage 6 execution rules

- Use **one real pilot opportunity**. The seeded `Social Media Content Planning Kit` fixture may remain a demo/reference but does not count as the required real pilot unless the founder explicitly chooses that exact opportunity and supplies real validation evidence for it.
- Gates 1-4 must be supported by real pilot evidence and genuine founder decisions at the existing approval checkpoints.
- Gate 5 must be labelled **mechanical/mock only** unless real marketplace/customer metrics are actually collected.
- Gate 6 must not approve increased spend from synthetic or seeded economics.
- Every founder approval must be recorded by its persisted `ApprovalRequest`/decision evidence; no chat statement or agent memory substitutes for an approval record.
- Memory is advisory context only. It cannot grant, revoke or substitute for approval authority, policy checks, current business state or commercial evidence.

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

## Remaining Stage 6 prerequisite: Gate-1 compliance blocker

The structured veto system is real: Finance, Compliance, Quality and Security roles can raise critical vetoes, and active critical vetoes block the board regardless of weighted score. However, the current mock `COMPLIANCE_AND_MARKETPLACE_POLICY_OFFICER` never raises a veto; when an opportunity risk string mentions marketplace policy, it still returns `APPROVE` with a monitoring note.

For a genuine Stage-6 pilot, Gate 1's `no critical compliance blocker` requirement must therefore have authoritative evidence independent of a mock provider's always-non-veto behavior. Before Gate 1 is marked PASS, add or designate a deterministic compliance/policy assessment that records whether a critical blocker exists, its reason/source and the policy-pack/version or evidence used. If the later board review raises a real Compliance veto, that remains an independent Gate-2 blocker as designed.

This does not require enabling a paid AI provider: the compliance-blocker assessment may be deterministic and policy-pack/evidence driven, as long as it is workspace-scoped, auditable, versioned and fail-closed when required evidence/policy context is missing.

**Rule enforced from day one**: do not scale paid advertising before low-cost validation — `FEATURE_ADVERTISING_ENABLED=false` by default and requires explicit founder action to change.

Stage-6 evidence belongs in `docs/COMMERCIAL_PILOT_LOG.md`.
