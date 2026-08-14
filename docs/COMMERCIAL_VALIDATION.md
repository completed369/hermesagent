# Commercial Validation Gates

Per master spec section 30. The six gate definitions and thresholds below are authoritative. The underlying opportunity, board, approval, product, listing, finance and experiment mechanisms now exist; Stage 6 must exercise them against one real pilot venture rather than treating seeded/demo data as commercial evidence.

| Gate | Key thresholds | Current readiness |
| --- | --- | --- |
| 1. Problem Validation | Defined customer + problem, evidence records, no critical compliance blocker | Mechanically reachable through Opportunity/Evidence records; not yet closed for a real Stage-6 pilot venture. |
| 2. Opportunity Validation | Opportunity score ≥70, Profit Confidence ≥70, evidence quality ≥70, board weighted approval ≥75%, no active critical veto, founder approval | Mechanically reachable through `scoring-engine`, `policy-engine`, Board Review and Founder Approval; must be exercised on the chosen real pilot opportunity. |
| 3. Product Validation | Complete package, QA passed, licences complete, hashes recorded, founder approval | Mechanically reachable through Product Studio/QA and Founder Approval; must be exercised on the chosen pilot product. |
| 4. Listing Validation | Marketplace policy checks passed, pricing validated, preview complete, founder approval | Mechanically reachable through Listing Studio/SEO/policy checks and Founder Approval; must be exercised on the chosen pilot listing. |
| 5. Commercial Validation | Impressions/conversion/refund-rate/margin/support-load metrics | Gate mechanics can be recorded with mock adapters, but a genuine pass requires real marketplace/customer signal. Mock metrics must never be presented as real commercial validation. |
| 6. Scale Decision | Positive unit economics, acceptable refund/quality/support, improving forecast accuracy, founder approval for spend increase | Scale-decision machinery exists and is founder-gated; a genuine Stage-6 pass requires real pilot economics/quality/support evidence rather than seeded/demo numbers. |

## Stage 6 execution rules

- Use **one real pilot opportunity**. The seeded `Social Media Content Planning Kit` fixture may remain a demo/reference but does not count as the required real pilot unless the founder explicitly chooses that exact opportunity and supplies real validation evidence for it.
- Gates 1-4 must be supported by real pilot evidence and genuine founder decisions at the existing approval checkpoints.
- Gate 5 must be labelled **mechanical/mock only** unless real marketplace/customer metrics are actually collected.
- Gate 6 must not approve increased spend from synthetic or seeded economics.
- Every founder approval must be recorded by its persisted `ApprovalRequest`/decision evidence; no chat statement or agent memory substitutes for an approval record.
- Memory is advisory context only. It cannot grant, revoke or substitute for approval authority, policy checks, current business state or commercial evidence.

**Rule enforced from day one**: do not scale paid advertising before low-cost validation — `FEATURE_ADVERTISING_ENABLED=false` by default and requires explicit founder action to change.

Stage-6 evidence belongs in `docs/COMMERCIAL_PILOT_LOG.md`.
