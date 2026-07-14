# Policy Engine

**Implemented and unit-tested**: `packages/policy-engine/src/policies.ts`
(`evaluateCorePolicies`) and `board-voting.ts` (`calculateBoardVotingResult`).

## Core policies implemented (12 of the master spec's 25; the rest require

domain models — Product, Listing, etc. — that don't exist until Phase 4+)

POL-001 external publication requires approval · POL-002 approval matches
artefact version · POL-003 approval matches package hash · POL-004 approval
not expired · POL-005 spend within approved max · POL-006 no critical
compliance risk · POL-007 no critical security risk · POL-008 no critical
quality issue · POL-009 no missing licence · POL-010 marketplace pack not
expired · POL-011 financial data valid · POL-012 evidence complete.

Every evaluation returns `{policyId, policyVersion, result, explanation,
inputs, blocking, remediation, timestamp}` — explainable and auditable by
design, matching master spec section 20. `hasBlockingFailure()` is the
single fail-closed gate callers must check.

## Board voting

`calculateBoardVotingResult` implements master spec section 13 exactly:
Approve = full weight, Revise = half, Reject = zero; default 75% threshold;
active critical vetoes (Finance/Compliance/Security/Quality) block
regardless of score; missing mandatory reviews block; evidence quality below
70 blocks. Fully deterministic — the numeric result never comes from an LLM.
Unit tests cover all five blocking conditions independently plus the clean
happy path.

## Not yet implemented

Policies 13–25 (integration write-defaults, real-customer-data prohibition
enforcement in code, log secret-scanning as a running check rather than a
static grep, duplicate-workflow-execution idempotency enforcement, etc.)
require modules that land in later phases; they are listed here so nothing
is silently dropped from the spec.
