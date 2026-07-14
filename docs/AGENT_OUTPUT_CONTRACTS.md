# Agent Output Contracts

**Implemented, unit-tested, and now live** (`packages/contracts/src/agent-output.ts`).
Every Board Review persists one `AgentOutputSchema`-validated `AgentOutput`
per voting role as a `BoardVote` row — the mock provider in
`packages/agent-runtime/src/mock-provider.ts` parses its own output through
this schema before returning it (fail-closed by construction), so no
non-conforming payload can reach the database.

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

## Invalid output handling

The mock provider always produces schema-valid output (enforced via
`AgentOutputSchema.parse()` before returning), so the retry-per-policy path
has not yet been exercised against a real failure. The fixed rule remains:
fail validation → record as invalid → retry per policy → never silently
convert to an approval → fail closed after the retry limit. This mirrors
master spec section 12 exactly, and is the contract any future real model
provider must also satisfy — `board-review-runner.ts` treats a missing or
invalid `AgentDefinition`/output as `BoardReviewInvalidOutputError`, marking
the whole `BoardReview` FAILED rather than persisting partial/invalid votes.

## Why this exists before the agents do

Locking the contract first means: (1) the board-voting math
(`calculateBoardVotingResult`) can be fully unit-tested against synthetic
`AgentOutput` objects today, and (2) whichever AI provider Phase 3 wires in
must conform to this schema — it cannot silently reshape the contract to fit
whatever the model happens to return.
