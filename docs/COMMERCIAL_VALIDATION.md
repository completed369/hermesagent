# Commercial Validation Gates

Per master spec section 30. The six gate definitions and thresholds below are authoritative. The underlying opportunity, board, approval, product, listing, finance and experiment mechanisms now exist; Stage 6 must exercise them against one real pilot venture rather than treating seeded/demo data as commercial evidence.

| Gate                      | Key thresholds                                                                                                                              | Current readiness                                                                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Problem Validation     | Defined customer + problem, evidence records, no critical compliance blocker                                                                | Partially reachable. Opportunity/Evidence records exist, but a genuine pilot still needs an authoritative compliance-blocker assessment rather than relying on the mock board's non-veto.  |
| 2. Opportunity Validation | Opportunity score ≥70, Profit Confidence ≥70, evidence quality ≥70, board weighted approval ≥75%, no active critical veto, founder approval | Partially reachable. Opportunity/Profit Confidence, board/veto and founder approval mechanisms exist; the standalone opportunity-level evidence-quality rollup still needs implementation. |
| 3. Product Validation     | Complete package, QA passed, licences complete, hashes recorded, founder approval                                                           | Mechanically reachable through Product Studio/QA and Founder Approval; must be exercised on the chosen pilot product.                                                                      |
| 4. Listing Validation     | Marketplace policy checks passed, pricing validated, preview complete, founder approval                                                     | Mechanically reachable through Listing Studio/SEO/policy checks and Founder Approval; must be exercised on the chosen pilot listing.                                                       |
| 5. Commercial Validation  | Impressions/conversion/refund-rate/margin/support-load metrics                                                                              | Gate mechanics can be recorded with mock adapters, but a genuine pass requires real marketplace/customer signal. Mock metrics must never be presented as real commercial validation.       |
| 6. Scale Decision         | Positive unit economics, acceptable refund/quality/support, improving forecast accuracy, founder approval for spend increase                | Scale-decision machinery exists and is founder-gated; a genuine Stage-6 pass requires real pilot economics/quality/support evidence rather than seeded/demo numbers.                       |

## Stage 6 execution rules

- Use **one real pilot opportunity**. The seeded `Social Media Content Planning Kit` fixture may remain a demo/reference but does not count as the required real pilot unless the founder explicitly chooses that exact opportunity and supplies real validation evidence for it.
- Gates 1-4 must be supported by real pilot evidence and genuine founder decisions at the existing approval checkpoints.
- Gate 5 must be labelled **mechanical/mock only** unless real marketplace/customer metrics are actually collected.
- Gate 6 must not approve increased spend from synthetic or seeded economics.
- Every founder approval must be recorded by its persisted `ApprovalRequest`/decision evidence; no chat statement or agent memory substitutes for an approval record.
- Memory is advisory context only. It cannot grant, revoke or substitute for approval authority, policy checks, current business state or commercial evidence.

## Stage 6 implementation prerequisite: fresh opportunity intake

Repository audit against release source `007e15b4ab93093b7a958150dabf1ba673c007c6` found that a fresh non-seed pilot opportunity cannot yet be created through the supported product surface:

- `OpportunitiesController` exposes list/get/reject/archive/promote only; there is no create endpoint.
- `OpportunitiesService` contains mutation handling for reject/archive/promote only.
- the Opportunity Feed renders existing records and detail links but has no new-opportunity intake control.
- research acquisition persists `DataSource` and `EvidenceArtifact` records; it does not create an `Opportunity`.
- the confirmed Opportunity creation path is the idempotent Phase-2 seed fixture in `packages/database/src/seed.ts`.

After Stage 5 is formally closed, Stage 6 should therefore begin by adding a founder-authorized/manual opportunity-intake path that creates a real workspace-scoped Opportunity plus its initial customer/problem/evidence inputs and score records. That implementation must preserve workspace isolation, audit every state-creating action, validate input server-side, calculate scores through the existing scoring engine rather than accepting arbitrary score values, and include integration/E2E coverage proving a fresh non-seed opportunity can reach the existing promotion/board/approval path.

This prerequisite is an implementation gap, not permission to auto-select a commercial opportunity or fabricate evidence. The founder still chooses/approves the real pilot and every existing approval checkpoint remains authoritative.

## Stage 6 implementation prerequisite: opportunity-level evidence quality

Gate 2 requires a standalone `evidence quality ≥70` result. The release source does not yet provide a mechanically enforceable opportunity-level calculation for that threshold:

- `EvidenceArtifact` stores individual `reliabilityScore`, `freshnessScore` and `relevanceScore` values on a 0-100 scale.
- `docs/EVIDENCE_MODEL.md` states that artifact reliability/freshness feed Profit Confidence inputs and explicitly says an automatic aggregate rollup per opportunity is still left for a later phase.
- `docs/SCORING_MODEL.md` defines `evidenceQuality` as a weighted Profit Confidence input but does not prescribe an opportunity-level aggregation formula from linked artifacts.
- `OpportunityScore` persists score factors, but the Opportunities API does not recompute scores when evidence changes; the scoring spec also leaves that recomputation for a later phase.
- `calculateBoardVotingResult` already supports `evidenceQualityScore` with a default minimum of 70 and blocks below that minimum, but `runBoardReview` currently calls the policy engine with weights only, so the live board path omits the evidence-quality gate input.

Therefore Stage 6 must not infer or hand-type a passing `evidence quality` number. After Stage 5 closes, implement a deterministic, documented opportunity-level evidence-quality calculation and rescore path before claiming Gate 2 can pass, then wire that authoritative score into `calculateBoardVotingResult`. The implementation should derive from authoritative linked evidence, preserve provenance, be reproducible/versioned, and include tests for missing, stale, low-reliability and mixed-quality evidence. If the master spec does not prescribe the exact aggregation formula, that formula must be explicitly documented as a project decision before it is used as a commercial gate.

## Stage 6 implementation prerequisite: Gate-1 compliance blocker

The structured veto system is real: Finance, Compliance, Quality and Security roles can raise critical vetoes, and active critical vetoes block the board regardless of weighted score. However, the current mock `COMPLIANCE_AND_MARKETPLACE_POLICY_OFFICER` never raises a veto; when an opportunity risk string mentions marketplace policy, it still returns `APPROVE` with a monitoring note.

For a genuine Stage-6 pilot, Gate 1's `no critical compliance blocker` requirement must therefore have authoritative evidence independent of a mock provider's always-non-veto behavior. Before Gate 1 is marked PASS, add or designate a deterministic compliance/policy assessment that records whether a critical blocker exists, its reason/source and the policy-pack/version or evidence used. If the later board review raises a real Compliance veto, that remains an independent Gate-2 blocker as designed.

This does not require enabling a paid AI provider: the compliance-blocker assessment may be deterministic and policy-pack/evidence driven, as long as it is workspace-scoped, auditable, versioned and fail-closed when required evidence/policy context is missing.

**Rule enforced from day one**: do not scale paid advertising before low-cost validation — `FEATURE_ADVERTISING_ENABLED=false` by default and requires explicit founder action to change.

Stage-6 evidence belongs in `docs/COMMERCIAL_PILOT_LOG.md`.
