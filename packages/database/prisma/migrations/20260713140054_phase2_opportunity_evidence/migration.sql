-- CreateTable
CREATE TABLE "data_sources" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "url" TEXT,
    "accessMethod" TEXT NOT NULL DEFAULT 'MANUAL_IMPORT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_artifacts" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "dataSourceId" UUID,
    "sourceName" TEXT NOT NULL,
    "sourceIdentifier" TEXT,
    "retrievedAt" TIMESTAMP(3) NOT NULL,
    "region" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "collectionMethod" TEXT NOT NULL,
    "collectionAgent" TEXT,
    "originalExcerpt" TEXT,
    "reliabilityScore" INTEGER NOT NULL,
    "freshnessScore" INTEGER NOT NULL,
    "relevanceScore" INTEGER NOT NULL,
    "termsOfUseNote" TEXT,
    "personalDataClassification" TEXT NOT NULL DEFAULT 'NONE',
    "contentHash" TEXT NOT NULL,
    "processingHistory" JSONB,
    "storageLocation" TEXT,
    "reviewDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_claims" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "evidenceArtifactId" UUID NOT NULL,
    "opportunityId" UUID,
    "claimType" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "value" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "target_customers" (
    "id" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "persona" TEXT NOT NULL,
    "painPoints" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "buyingTriggers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "target_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_recommendations" (
    "id" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_scores" (
    "id" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "scoreType" TEXT NOT NULL,
    "formulaVersion" TEXT NOT NULL,
    "score" DECIMAL(6,2) NOT NULL,
    "factors" JSONB NOT NULL,
    "factorContributions" JSONB,
    "isSpeculative" BOOLEAN,
    "calculatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunity_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunities" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "suggestedProductType" TEXT,
    "suggestedMarketplace" TEXT,
    "estimatedCostEur" DECIMAL(10,2),
    "estimatedRevenueEur" DECIMAL(10,2),
    "estimatedProfitEur" DECIMAL(10,2),
    "timeToLaunchDays" INTEGER,
    "risks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "latestOpportunityScore" DECIMAL(6,2),
    "latestProfitConfidence" DECIMAL(6,2),
    "isSpeculative" BOOLEAN NOT NULL DEFAULT false,
    "rejectionReason" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "promotedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venture_proposals" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "venture_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venture_proposal_versions" (
    "id" UUID NOT NULL,
    "ventureProposalId" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL DEFAULT 1,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "venture_proposal_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "evidence_artifacts_workspaceId_idx" ON "evidence_artifacts"("workspaceId");

-- CreateIndex
CREATE INDEX "evidence_claims_workspaceId_idx" ON "evidence_claims"("workspaceId");

-- CreateIndex
CREATE INDEX "evidence_claims_opportunityId_idx" ON "evidence_claims"("opportunityId");

-- CreateIndex
CREATE INDEX "opportunity_scores_opportunityId_scoreType_idx" ON "opportunity_scores"("opportunityId", "scoreType");

-- CreateIndex
CREATE INDEX "opportunities_workspaceId_status_idx" ON "opportunities"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "opportunities_workspaceId_title_key" ON "opportunities"("workspaceId", "title");

-- CreateIndex
CREATE UNIQUE INDEX "venture_proposals_opportunityId_key" ON "venture_proposals"("opportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "venture_proposal_versions_ventureProposalId_versionNumber_key" ON "venture_proposal_versions"("ventureProposalId", "versionNumber");

-- AddForeignKey
ALTER TABLE "evidence_artifacts" ADD CONSTRAINT "evidence_artifacts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_artifacts" ADD CONSTRAINT "evidence_artifacts_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "data_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_claims" ADD CONSTRAINT "evidence_claims_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_claims" ADD CONSTRAINT "evidence_claims_evidenceArtifactId_fkey" FOREIGN KEY ("evidenceArtifactId") REFERENCES "evidence_artifacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_claims" ADD CONSTRAINT "evidence_claims_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "target_customers" ADD CONSTRAINT "target_customers_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_recommendations" ADD CONSTRAINT "channel_recommendations_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_scores" ADD CONSTRAINT "opportunity_scores_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venture_proposals" ADD CONSTRAINT "venture_proposals_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venture_proposals" ADD CONSTRAINT "venture_proposals_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venture_proposal_versions" ADD CONSTRAINT "venture_proposal_versions_ventureProposalId_fkey" FOREIGN KEY ("ventureProposalId") REFERENCES "venture_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venture_proposal_versions" ADD CONSTRAINT "venture_proposal_versions_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
