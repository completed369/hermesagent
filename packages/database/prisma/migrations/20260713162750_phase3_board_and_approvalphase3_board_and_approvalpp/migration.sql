-- CreateTable
CREATE TABLE "agent_definitions" (
    "id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isVoting" BOOLEAN NOT NULL DEFAULT true,
    "weight" INTEGER,
    "responsibilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "toolAllowlist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "prohibitedActions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "modelProvider" TEXT NOT NULL DEFAULT 'mock',
    "modelName" TEXT NOT NULL DEFAULT 'mock-v1',
    "costLimitEur" DECIMAL(10,2),
    "timeoutMs" INTEGER NOT NULL DEFAULT 30000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_prompt_versions" (
    "id" UUID NOT NULL,
    "agentDefinitionId" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "promptText" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_prompt_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_reviews" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "ventureProposalId" UUID NOT NULL,
    "ventureProposalVersionId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "votingResult" JSONB,
    "blocked" BOOLEAN,
    "meetsThreshold" BOOLEAN,
    "failureReason" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_votes" (
    "id" UUID NOT NULL,
    "boardReviewId" UUID NOT NULL,
    "agentDefinitionId" UUID NOT NULL,
    "agentRole" TEXT NOT NULL,
    "agentVersion" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL,
    "output" JSONB NOT NULL,
    "isValid" BOOLEAN NOT NULL DEFAULT true,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_vetoes" (
    "id" UUID NOT NULL,
    "boardReviewId" UUID NOT NULL,
    "boardVoteId" UUID NOT NULL,
    "agentRole" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_vetoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_summaries" (
    "id" UUID NOT NULL,
    "boardReviewId" UUID NOT NULL,
    "agreementSummary" TEXT NOT NULL,
    "disagreementSummary" TEXT NOT NULL,
    "vetoSummary" TEXT NOT NULL,
    "overallConfidence" INTEGER NOT NULL,
    "recommendation" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "decision_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revision_requests" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "ventureProposalId" UUID NOT NULL,
    "boardReviewId" UUID,
    "approvalRequestId" UUID,
    "requestedChanges" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "revision_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "ventureProposalId" UUID NOT NULL,
    "ventureProposalVersionId" UUID NOT NULL,
    "boardReviewId" UUID,
    "requestedAction" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "affectedResources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "packageHash" TEXT NOT NULL,
    "estimatedCostEur" DECIMAL(10,2) NOT NULL,
    "maxAuthorizedCostEur" DECIMAL(10,2) NOT NULL,
    "reversible" BOOLEAN NOT NULL,
    "risks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "evidenceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedBy" TEXT NOT NULL,
    "workflowId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "executedAt" TIMESTAMP(3),
    "executionResult" JSONB,
    "executionSuccess" BOOLEAN,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "revocationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_decisions" (
    "id" UUID NOT NULL,
    "approvalRequestId" UUID NOT NULL,
    "founderIdentity" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL,
    "decision" TEXT NOT NULL,
    "conditions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "comment" TEXT,
    "approvedAmountEur" DECIMAL(10,2),
    "approvedArtifactVersionId" TEXT NOT NULL,
    "approvedPackageHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "auditSignature" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_definitions_role_key" ON "agent_definitions"("role");

-- CreateIndex
CREATE UNIQUE INDEX "agent_prompt_versions_agentDefinitionId_version_key" ON "agent_prompt_versions"("agentDefinitionId", "version");

-- CreateIndex
CREATE INDEX "board_reviews_workspaceId_ventureProposalId_idx" ON "board_reviews"("workspaceId", "ventureProposalId");

-- CreateIndex
CREATE UNIQUE INDEX "board_votes_boardReviewId_agentRole_key" ON "board_votes"("boardReviewId", "agentRole");

-- CreateIndex
CREATE UNIQUE INDEX "decision_summaries_boardReviewId_key" ON "decision_summaries"("boardReviewId");

-- CreateIndex
CREATE INDEX "revision_requests_workspaceId_ventureProposalId_idx" ON "revision_requests"("workspaceId", "ventureProposalId");

-- CreateIndex
CREATE INDEX "approval_requests_workspaceId_ventureProposalId_idx" ON "approval_requests"("workspaceId", "ventureProposalId");

-- CreateIndex
CREATE INDEX "approval_decisions_approvalRequestId_idx" ON "approval_decisions"("approvalRequestId");

-- AddForeignKey
ALTER TABLE "agent_prompt_versions" ADD CONSTRAINT "agent_prompt_versions_agentDefinitionId_fkey" FOREIGN KEY ("agentDefinitionId") REFERENCES "agent_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_reviews" ADD CONSTRAINT "board_reviews_ventureProposalVersionId_fkey" FOREIGN KEY ("ventureProposalVersionId") REFERENCES "venture_proposal_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_votes" ADD CONSTRAINT "board_votes_boardReviewId_fkey" FOREIGN KEY ("boardReviewId") REFERENCES "board_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_votes" ADD CONSTRAINT "board_votes_agentDefinitionId_fkey" FOREIGN KEY ("agentDefinitionId") REFERENCES "agent_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_vetoes" ADD CONSTRAINT "board_vetoes_boardReviewId_fkey" FOREIGN KEY ("boardReviewId") REFERENCES "board_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_vetoes" ADD CONSTRAINT "board_vetoes_boardVoteId_fkey" FOREIGN KEY ("boardVoteId") REFERENCES "board_votes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_summaries" ADD CONSTRAINT "decision_summaries_boardReviewId_fkey" FOREIGN KEY ("boardReviewId") REFERENCES "board_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revision_requests" ADD CONSTRAINT "revision_requests_boardReviewId_fkey" FOREIGN KEY ("boardReviewId") REFERENCES "board_reviews"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revision_requests" ADD CONSTRAINT "revision_requests_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "approval_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_ventureProposalVersionId_fkey" FOREIGN KEY ("ventureProposalVersionId") REFERENCES "venture_proposal_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_boardReviewId_fkey" FOREIGN KEY ("boardReviewId") REFERENCES "board_reviews"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "approval_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
