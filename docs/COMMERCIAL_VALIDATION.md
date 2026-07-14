# Commercial Validation Gates

Per master spec section 30. None of these gates are reachable yet (Phase 1
has no opportunities, proposals, products, or listings) — recorded here so
Phase 2+ implements exactly these thresholds rather than inventing new ones.

| Gate                      | Key thresholds                                                                                                                              | Status                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1. Problem Validation     | Defined customer + problem, evidence records, no critical compliance blocker                                                                | Not reachable (Phase 2)                                                                          |
| 2. Opportunity Validation | Opportunity score ≥70, Profit Confidence ≥70, evidence quality ≥70, board weighted approval ≥75%, no active critical veto, founder approval | Scoring math ready (`scoring-engine`), board math ready (`policy-engine`) — nothing to score yet |
| 3. Product Validation     | Complete package, QA passed, licences complete, hashes recorded, founder approval                                                           | Not reachable (Phase 4)                                                                          |
| 4. Listing Validation     | Marketplace policy checks passed, pricing validated, preview complete, founder approval                                                     | Not reachable (Phase 4)                                                                          |
| 5. Commercial Validation  | Impressions/conversion/refund-rate/margin/support-load metrics                                                                              | Not reachable (Phase 6)                                                                          |
| 6. Scale Decision         | Positive unit economics, acceptable refund/quality/support, improving forecast accuracy, founder approval for spend increase                | Not reachable (Phase 7)                                                                          |

**Rule enforced from day one**: do not scale paid advertising before
low-cost validation — `FEATURE_ADVERTISING_ENABLED=false` by default and
requires explicit founder action to change.
