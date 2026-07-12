# Agent Output Contracts

**Implemented and unit-tested now** (`packages/contracts/src/agent-output.ts`)
even though no agent calls it yet, so Phase 3 has a locked schema to build
against.

## Schema (Zod, strict mode — unknown fields rejected)

```
agentRole, agentVersion, proposalVersionId (uuid), decision (APPROVE|REVISE|REJECT),
confidence (0-100), summary, reasons[], supportingEvidenceIds[uuid],
assumptions[], missingInformation[], risks[{title,severity,probability,mitigation}],
requiredChanges[], estimatedImpact, veto{active,type,reason}
```

Cross-field validation (`superRefine`): an active veto must declare a real
`type` (not `NONE`) and a non-empty `reason`; an inactive veto must have
`type: NONE`. This prevents the two classes of malformed veto that would
otherwise be ambiguous to a downstream policy check.

## Invalid output handling (not yet wired to a real agent, but the rule is
fixed): fail validation → record as invalid → retry per policy → never
silently convert to an approval → fail closed after the retry limit. This
mirrors master spec section 12 exactly.

## Why this exists before the agents do

Locking the contract first means: (1) the board-voting math
(`calculateBoardVotingResult`) can be fully unit-tested against synthetic
`AgentOutput` objects today, and (2) whichever AI provider Phase 3 wires in
must conform to this schema — it cannot silently reshape the contract to fit
whatever the model happens to return.
