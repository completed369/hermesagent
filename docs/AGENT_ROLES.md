# Agent Roles

**Status: architected, not yet running (Phase 3).** This document specifies
the eight voting board agents and the non-voting Decision Synthesiser per
master spec section 11, so Phase 3 implements exactly this contract.

| # | Role | Weight | Critical veto? |
|---|---|---|---|
| 1 | Market Intelligence Director | 15 | No |
| 2 | Product Strategy Director | 15 | No |
| 3 | Creative and Production Director | 10 | No |
| 4 | Finance and Risk Officer | 15 | Yes (FINANCE) |
| 5 | Growth Director | 10 | No |
| 6 | Compliance and Marketplace Policy Officer | 15 | Yes (COMPLIANCE) |
| 7 | Operations and Quality Officer | 10 | Yes (QUALITY) |
| 8 | Red Team and Security Officer | 10 | Yes (SECURITY) |

Weights and veto mapping are already implemented and unit-tested in
`packages/policy-engine/src/board-voting.ts` (`DEFAULT_AGENT_WEIGHTS`,
`CRITICAL_VETO_ROLES`), ahead of the agents themselves existing, so the
voting math is locked in and verifiable independent of any AI provider.

The **Decision Synthesiser** is non-voting: it may summarise, but must never
vote, approve, override, remove a veto, execute, or replace founder
authority (master spec section 11, last paragraph).

Each agent (when implemented) must declare: unique role, responsibilities,
explicit tool allowlist, explicit prohibited actions, structured I/O schema
(`@ventureos/contracts` `AgentOutputSchema`), prompt version, model config,
cost limits, timeout limits, evaluation criteria, audit trail. See
`docs/AGENT_OUTPUT_CONTRACTS.md`.
