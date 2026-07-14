# Agent Roles

**Status: implemented and running (Phase 3, live-verified).** This document
specifies the eight voting board agents and the non-voting Decision
Synthesiser per master spec section 11. All eight roles are now seeded as
`AgentDefinition` rows (with an initial `AgentPromptVersion` "v1") and
produce real `AgentOutputSchema`-validated votes via the Phase 3 mock
provider (`packages/agent-runtime/src/mock-provider.ts`) whenever a Board
Review is run. Live-verified end-to-end via the web UI on 2026-07-13: all 8
roles voted APPROVE against the seeded Social Media Content Planning Kit
venture proposal, producing a weighted score of 100/75 with no vetoes.

| #   | Role                                      | Weight | Critical veto?   |
| --- | ----------------------------------------- | ------ | ---------------- |
| 1   | Market Intelligence Director              | 15     | No               |
| 2   | Product Strategy Director                 | 15     | No               |
| 3   | Creative and Production Director          | 10     | No               |
| 4   | Finance and Risk Officer                  | 15     | Yes (FINANCE)    |
| 5   | Growth Director                           | 10     | No               |
| 6   | Compliance and Marketplace Policy Officer | 15     | Yes (COMPLIANCE) |
| 7   | Operations and Quality Officer            | 10     | Yes (QUALITY)    |
| 8   | Red Team and Security Officer             | 10     | Yes (SECURITY)   |

Weights and veto mapping are already implemented and unit-tested in
`packages/policy-engine/src/board-voting.ts` (`DEFAULT_AGENT_WEIGHTS`,
`CRITICAL_VETO_ROLES`), ahead of the agents themselves existing, so the
voting math is locked in and verifiable independent of any AI provider.

The **Decision Synthesiser** is non-voting: it may summarise, but must never
vote, approve, override, remove a veto, execute, or replace founder
authority (master spec section 11, last paragraph).

Each agent declares: unique role, responsibilities, explicit tool allowlist,
explicit prohibited actions, structured I/O schema (`@ventureos/contracts`
`AgentOutputSchema`), prompt version, model config, cost limits, timeout
limits, evaluation criteria, audit trail — all now persisted on the
`AgentDefinition`/`AgentPromptVersion` Prisma models and seeded by
`packages/database/src/seed.ts`. See `docs/AGENT_OUTPUT_CONTRACTS.md`.

## Mock provider (Phase 3 default, no live model calls)

`runMockBoardAgent`/`runAllMockBoardAgents` in
`packages/agent-runtime/src/mock-provider.ts` implement a deterministic
per-role "lens" over the Phase 2 persisted opportunity/profit-confidence
scores — no randomisation, no live research, so results are reproducible for
tests and audit trails. The Finance and Risk Officer's lens is the one
critical-veto path currently exercised: it fires a FINANCE veto when
`estimatedCostEur > 0 && isSpeculative && profitConfidenceScore < 40`.
Swapping in a real model provider later only requires a new module that
still returns `AgentOutputSchema`-valid output — `board-review-runner.ts`,
the voting math, and the veto/threshold logic do not change.
