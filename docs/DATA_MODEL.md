# Data Model

## Phase 1 entities (implemented, `packages/database/prisma/schema.prisma`)

**Identity & access**: `User`, `Account`, `Session`, `Workspace`, `Role`,
`Permission`, `RolePermission`, `WorkspaceMember`, `FounderProfile`,
`FounderOnboardingProfile`, `SecurityEvent`.

**Audit**: `AuditEvent` (append-only by application convention; integrity
hash computed from canonical JSON of the event content).

**Workflow**: `WorkflowRun`, `WorkflowStep` (populated once Phase 3+
workflows persist their state here in addition to Temporal's own history;
Phase 1's `helloWorkflow` does not yet write these rows — Temporal itself is
the source of truth for the connectivity check).

**Integrations**: `Integration`, `SecretReference` (reference only — never
the secret value itself).

All primary keys are UUIDs. Soft deletion (`deletedAt`) is used on `User`
and `Workspace`. `AuditEvent` has no delete/update path in the application
layer at all (see `apps/api/src/modules/audit/audit.service.ts` — it is the
only writer, and only ever calls `.create()`).

## Entities NOT yet in the schema (Phase 2+)

Opportunity, OpportunityScore, TargetCustomer, ChannelRecommendation,
DataSource, DataAcquisitionContract, EvidenceArtifact, EvidenceClaim,
EvidenceRelationship, EvidenceReview, VentureProposal(+Version), BoardReview,
BoardVote, BoardVeto, DecisionSummary, ApprovalRequest, ApprovalDecision,
ApprovalCondition, ApprovalExecution, PolicyDefinition(+Version),
PolicyEvaluation, MarketplacePolicyPack(+Version), Product(+Version),
ProductAsset(+Version), ProductBrief, ProductPackage, LicenceRecord,
QualityCheck(Result), Listing(+Version), ListingImage/File, PriceProposal,
SEOEvaluation, PublicationAttempt, FinancialAssumption, FinancialForecast,
FinancialScenario, Expense, RevenueEntry, MarketplaceFee, RefundRequest,
Budget(Allocation), CostLedgerEntry, Experiment(+Variant/Metric/Result/
Decision), AgentDefinition, AgentPromptVersion, AgentRun, AgentToolCall,
ModelUsage, ModelCost, Notification(Preference).

Master spec section 22 lists the full target model; adding these in Phase 2
onward is additive (new tables + relations), not a rewrite, because Phase 1
already establishes the Workspace/AuditEvent/WorkflowRun spine everything
else hangs off.

## Migrations

No migration has been generated or run in this sandbox (no DB reachable).
Run `pnpm db:migrate:dev` locally to generate the first real migration from
this schema — see `docs/LOCAL_VERIFICATION_CHECKLIST.md`.
