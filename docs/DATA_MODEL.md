# Data Model

## Phase 1 entities (implemented, `packages/database/prisma/schema.prisma`)

**Identity & access**: `User`, `Account`, `Session`, `Workspace`, `Role`,
`Permission`, `RolePermission`, `WorkspaceMember`, `FounderProfile`,
`FounderOnboardingProfile`, `SecurityEvent`.

**Audit**: `AuditEvent` (immutable event content; versioned integrity checksum,
workspace/source replay keys, and governed retention/erasure semantics).

**ACP authorization**: `AcpApprovalRequest` (exact workspace/task/run/action,
target, evidence, and policy binding), `AcpApprovalDecision` (immutable Level-4
decision evidence), and `AcpExecutionPermit` (single-use authorization claim;
claiming is not external execution). See ADR-0019.

**Durable ACP work graph**: `AcpObjective` -> `AcpProject` -> `AcpTask` ->
`AcpRun` -> `AcpArtifact`, with `AcpTaskDependency` for same-workspace,
same-objective dependency edges. Composite workspace keys and migration-managed
guards prevent cross-tenant joins and binding drift. Level-4 runs are persisted
unassigned in `AWAITING_APPROVAL`; routine runs are `PREPARED`. This schema is a
non-executing coordination/evidence spine, not proof that any runtime is
connected. See ADR-0020.

**Workflow**: `WorkflowRun`, `WorkflowStep` (populated once Phase 3+
workflows persist their state here in addition to Temporal's own history;
Phase 1's `helloWorkflow` does not yet write these rows — Temporal itself is
the source of truth for the connectivity check).

**Integrations**: `Integration`, `SecretReference` (reference only — never
the secret value itself).

All primary keys are UUIDs. Soft deletion (`deletedAt`) is used on `User`
and `Workspace`. Application event writers insert through reviewed audit
helpers. The database rejects changes to immutable event content; relational
identity/workspace links may clear during erasure, and explicit deletion is
reserved for governed retention or erasure. See ADR-0018.
ACP authorization bindings and decisions are database-guarded against mutation;
requests follow a constrained state machine, while workspace cascade deletion
and approver relation clearing preserve tenant/user erasure semantics.

## Phase 2 entities (implemented, `packages/database/prisma/schema.prisma`)

**Opportunity & evidence spine**: `DataSource` (provenance root — official
API, public export, founder-provided, or manual import), `EvidenceArtifact`
(one row per piece of collected evidence: source, retrieval date, region,
collection method/agent, reliability/freshness/relevance scores 0-100,
terms-of-use note, personal-data classification, `contentHash`),
`EvidenceClaim` (one row per material claim extracted from an artifact,
tagged with one of the six classification types — see
`docs/EVIDENCE_MODEL.md`), `TargetCustomer`, `ChannelRecommendation`,
`OpportunityScore` (one row per score calculation — `scoreType` is
`OPPORTUNITY` or `PROFIT_CONFIDENCE`, `formulaVersion` pins the exact
scoring-engine version used, `factorContributions`/`isSpeculative` retained
alongside the raw `factors` input), `Opportunity` (the candidate venture
itself — status lifecycle `NEW → UNDER_REVIEW → PROMOTED` or
`REJECTED`/`ARCHIVED`; denormalized `latestOpportunityScore` /
`latestProfitConfidence` / `isSpeculative` for fast list-page rendering,
kept in sync by whatever last wrote an `OpportunityScore` row).

**Venture proposal**: `VentureProposal` (one per opportunity, unique on
`opportunityId`; `status` starts `DRAFT`), `VentureProposalVersion`
(append-only snapshot history — every `promote` call adds a new version
rather than mutating the proposal, so the founder can see how the proposal
evolved; unique on `(ventureProposalId, versionNumber)`).

All new tables use UUID PKs, are workspace-scoped via `workspaceId` (except
`TargetCustomer`/`ChannelRecommendation`/`OpportunityScore`, which scope
through their parent `Opportunity`), and cascade-delete with their parent
except `EvidenceArtifact.dataSourceId`, which is `SetNull` (an artifact
survives its data source being removed).

## Entities NOT yet in the schema (Phase 3+)

BoardReview, BoardVote, BoardVeto, DecisionSummary, ApprovalRequest,
ApprovalDecision, ApprovalCondition, ApprovalExecution, PolicyDefinition(+Version),
PolicyEvaluation, MarketplacePolicyPack(+Version), Product(+Version),
ProductAsset(+Version), ProductBrief, ProductPackage, LicenceRecord,
QualityCheck(Result), Listing(+Version), ListingImage/File, PriceProposal,
SEOEvaluation, PublicationAttempt, FinancialAssumption, FinancialForecast,
FinancialScenario, Expense, RevenueEntry, MarketplaceFee, RefundRequest,
Budget(Allocation), CostLedgerEntry, Experiment(+Variant/Metric/Result/
Decision), AgentDefinition, AgentPromptVersion, AgentRun, AgentToolCall,
ModelUsage, ModelCost, Notification(Preference), DataAcquisitionContract,
EvidenceRelationship, EvidenceReview.

Master spec section 22 lists the full target model; adding these in Phase 3
onward is additive (new tables + relations), not a rewrite, because Phase 1
already establishes the Workspace/AuditEvent/WorkflowRun spine and Phase 2
establishes the Opportunity/Evidence spine everything else hangs off. (Note:
this list reflects Phase 2's snapshot and was not maintained phase-by-phase
after that — every entity above except the Phase 8 additions below has
since actually been implemented across Phases 3-7; see each phase's section
in `docs/EXECUTION_PLAN.md` for the real, current model list per phase.)

## Phase 8 entities (implemented, `packages/database/prisma/schema.prisma`)

**Multi-venture and SaaS spine**: `Plan` (the 4 resellable tiers — TRIAL,
STARTER, GROWTH, AGENCY — each with `priceMonthlyEur`, `maxVentures`,
`maxWorkspaceMembers`, `maxMarketplaceAccounts`, and a `features` string
array), `Subscription` (one per workspace, unique on `workspaceId`;
`status` lifecycle `TRIALING → ACTIVE → PAST_DUE`/`CANCELED`;
`billingMode` hardcoded `'MOCK'`, see `docs/DECISIONS.md` ADR-010),
`SubscriptionInvoice` (append-only per-period record, `status` always
`'PAID'` unconditionally — never the result of an actual charge),
`LicenseKey` (for self-hosted/exportable installs — `key` value, `status`
lifecycle `ACTIVE → REVOKED`/`EXPIRED`, unique `key`, workspace-scoped),
`WorkspaceBranding` (one per workspace, unique on `workspaceId`; brand
name/logo URL/accent color/terminology overrides, applied live to the
dashboard shell).

No new venture/multi-tenancy tables were needed beyond these: the existing
`Opportunity` → `VentureProposal` 1:1 relation (Phase 2) already supported
many concurrent ventures per workspace, and every table across every phase
already hangs off `workspaceId` (per `docs/ARCHITECTURE.md`'s "server-side
authorization, always" principle) — Phase 8 only added the plan/billing
layer and the license/branding tables on top of that already-multi-tenant-
ready spine.

All new tables use UUID PKs and cascade-delete with their parent
`Workspace`.

## Phase 9 identity extension

`Session.activeWorkspaceId` is the server-owned tenant context for every
authenticated request. The field is nullable only for migration safety;
`SessionAuthGuard` rejects a session unless the referenced workspace has a
current `WorkspaceMember` row for the same user. New logins always select a
deterministic existing membership, and users may switch only to workspaces in
their own membership list. The foreign key uses `ON DELETE SET NULL`, which
turns a deleted workspace into a fail-closed session rather than silently
selecting another tenant.

`WorkspaceInvitation` stores only the domain-separated digest of a random
single-use bearer token. Signed-in acceptance creates the tenant membership,
records `acceptedById`, and changes only the accepting session's active
workspace in one transaction.

## Migrations

The Phase 2 migration is generated and applied via
`pnpm db:migrate:dev --name phase2_opportunity_evidence` (see
`docs/LOCAL_VERIFICATION_CHECKLIST.md`). The Phase 8 migration
(`20260714132415_phase8_multi_venture_and_saas`) was generated and applied
the same way.
