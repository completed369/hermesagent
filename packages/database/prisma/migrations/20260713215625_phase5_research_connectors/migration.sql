-- AlterTable
ALTER TABLE "data_sources" ADD COLUMN     "dataAcquisitionContractId" UUID;

-- CreateTable
CREATE TABLE "data_acquisition_contracts" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "accessMethod" TEXT NOT NULL,
    "authenticationMethod" TEXT NOT NULL DEFAULT 'NONE',
    "allowedOperations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "prohibitedOperations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rateLimitPerMinute" INTEGER,
    "rateLimitPerDay" INTEGER,
    "expectedSchema" JSONB,
    "freshnessRequirementHours" INTEGER NOT NULL DEFAULT 720,
    "retryPolicy" TEXT NOT NULL DEFAULT 'EXPONENTIAL_BACKOFF_3_ATTEMPTS',
    "failureHandling" TEXT NOT NULL DEFAULT 'FAIL_CLOSED',
    "retentionDays" INTEGER NOT NULL DEFAULT 365,
    "personalDataClassification" TEXT NOT NULL DEFAULT 'NONE',
    "termsOfUseNote" TEXT,
    "geographicLimitations" TEXT,
    "monitoringNote" TEXT,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "disabledReason" TEXT,
    "costPerRunEurEstimate" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_acquisition_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_acquisition_runs" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "costEur" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "itemsRetrieved" INTEGER NOT NULL DEFAULT 0,
    "promptInjectionFlagged" BOOLEAN NOT NULL DEFAULT false,
    "promptInjectionMatches" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "blockedReason" TEXT,
    "errorMessage" TEXT,
    "evidenceArtifactId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_acquisition_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "data_acquisition_contracts_workspaceId_idx" ON "data_acquisition_contracts"("workspaceId");

-- CreateIndex
CREATE INDEX "data_acquisition_runs_workspaceId_idx" ON "data_acquisition_runs"("workspaceId");

-- CreateIndex
CREATE INDEX "data_acquisition_runs_contractId_idx" ON "data_acquisition_runs"("contractId");

-- AddForeignKey
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_dataAcquisitionContractId_fkey" FOREIGN KEY ("dataAcquisitionContractId") REFERENCES "data_acquisition_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_acquisition_contracts" ADD CONSTRAINT "data_acquisition_contracts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_acquisition_runs" ADD CONSTRAINT "data_acquisition_runs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_acquisition_runs" ADD CONSTRAINT "data_acquisition_runs_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "data_acquisition_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
