-- AlterTable
ALTER TABLE "approval_requests" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'VENTURE_PROPOSAL',
ADD COLUMN     "productPackageId" UUID;

-- CreateTable
CREATE TABLE "marketplace_policy_packs" (
    "id" UUID NOT NULL,
    "marketplace" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketplace_policy_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_policy_pack_versions" (
    "id" UUID NOT NULL,
    "marketplacePolicyPackId" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "supportedProductTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "listingFieldRequirements" JSONB NOT NULL,
    "imageRequirements" JSONB NOT NULL,
    "fileRequirements" JSONB NOT NULL,
    "restrictedCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ipChecks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pricingRules" JSONB NOT NULL,
    "apiCapabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "draftModeOnly" BOOLEAN NOT NULL DEFAULT true,
    "publicationRequirements" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rateLimits" JSONB NOT NULL,
    "approvalRequirements" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastVerifiedAt" TIMESTAMP(3) NOT NULL,
    "reviewDueAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketplace_policy_pack_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "ventureProposalId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_versions" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_briefs" (
    "id" UUID NOT NULL,
    "productVersionId" UUID NOT NULL,
    "productType" TEXT NOT NULL,
    "targetAssetKinds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_briefs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_assets" (
    "id" UUID NOT NULL,
    "productVersionId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_asset_versions" (
    "id" UUID NOT NULL,
    "productAssetId" UUID NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_asset_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_packages" (
    "id" UUID NOT NULL,
    "productVersionId" UUID NOT NULL,
    "listingVersionId" UUID,
    "packageHash" TEXT NOT NULL,
    "assetVersionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "licence_records" (
    "id" UUID NOT NULL,
    "productVersionId" UUID NOT NULL,
    "productAssetVersionId" UUID NOT NULL,
    "licenceType" TEXT NOT NULL,
    "termsSummary" TEXT NOT NULL,
    "attribution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "licence_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_checks" (
    "id" UUID NOT NULL,
    "productVersionId" UUID NOT NULL,
    "checkType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quality_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_check_results" (
    "id" UUID NOT NULL,
    "qualityCheckId" UUID NOT NULL,
    "ruleId" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'LOW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quality_check_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listings" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "productVersionId" UUID NOT NULL,
    "marketplace" TEXT NOT NULL DEFAULT 'etsy',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_versions" (
    "id" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "category" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "priceEur" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_images" (
    "id" UUID NOT NULL,
    "listingVersionId" UUID NOT NULL,
    "productAssetVersionId" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "altText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_files" (
    "id" UUID NOT NULL,
    "listingVersionId" UUID NOT NULL,
    "productAssetVersionId" UUID NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_proposals" (
    "id" UUID NOT NULL,
    "listingVersionId" UUID NOT NULL,
    "priceEur" DECIMAL(10,2) NOT NULL,
    "rationale" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_evaluations" (
    "id" UUID NOT NULL,
    "listingVersionId" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "checks" JSONB NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seo_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publication_attempts" (
    "id" UUID NOT NULL,
    "listingVersionId" UUID NOT NULL,
    "marketplace" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_ATTEMPTED',
    "blockedReason" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publication_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_policy_packs_marketplace_key" ON "marketplace_policy_packs"("marketplace");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_policy_pack_versions_marketplacePolicyPackId_ve_key" ON "marketplace_policy_pack_versions"("marketplacePolicyPackId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "products_ventureProposalId_key" ON "products"("ventureProposalId");

-- CreateIndex
CREATE UNIQUE INDEX "product_versions_productId_versionNumber_key" ON "product_versions"("productId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "product_briefs_productVersionId_key" ON "product_briefs"("productVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "product_assets_productVersionId_kind_label_key" ON "product_assets"("productVersionId", "kind", "label");

-- CreateIndex
CREATE UNIQUE INDEX "product_asset_versions_productAssetId_attempt_key" ON "product_asset_versions"("productAssetId", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "licence_records_productAssetVersionId_key" ON "licence_records"("productAssetVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "listings_productId_marketplace_key" ON "listings"("productId", "marketplace");

-- CreateIndex
CREATE UNIQUE INDEX "listing_versions_listingId_versionNumber_key" ON "listing_versions"("listingId", "versionNumber");

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_productPackageId_fkey" FOREIGN KEY ("productPackageId") REFERENCES "product_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_policy_pack_versions" ADD CONSTRAINT "marketplace_policy_pack_versions_marketplacePolicyPackId_fkey" FOREIGN KEY ("marketplacePolicyPackId") REFERENCES "marketplace_policy_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_ventureProposalId_fkey" FOREIGN KEY ("ventureProposalId") REFERENCES "venture_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_versions" ADD CONSTRAINT "product_versions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_briefs" ADD CONSTRAINT "product_briefs_productVersionId_fkey" FOREIGN KEY ("productVersionId") REFERENCES "product_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_assets" ADD CONSTRAINT "product_assets_productVersionId_fkey" FOREIGN KEY ("productVersionId") REFERENCES "product_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_asset_versions" ADD CONSTRAINT "product_asset_versions_productAssetId_fkey" FOREIGN KEY ("productAssetId") REFERENCES "product_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_packages" ADD CONSTRAINT "product_packages_productVersionId_fkey" FOREIGN KEY ("productVersionId") REFERENCES "product_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_packages" ADD CONSTRAINT "product_packages_listingVersionId_fkey" FOREIGN KEY ("listingVersionId") REFERENCES "listing_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "licence_records" ADD CONSTRAINT "licence_records_productVersionId_fkey" FOREIGN KEY ("productVersionId") REFERENCES "product_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "licence_records" ADD CONSTRAINT "licence_records_productAssetVersionId_fkey" FOREIGN KEY ("productAssetVersionId") REFERENCES "product_asset_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_checks" ADD CONSTRAINT "quality_checks_productVersionId_fkey" FOREIGN KEY ("productVersionId") REFERENCES "product_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_check_results" ADD CONSTRAINT "quality_check_results_qualityCheckId_fkey" FOREIGN KEY ("qualityCheckId") REFERENCES "quality_checks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_productVersionId_fkey" FOREIGN KEY ("productVersionId") REFERENCES "product_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_versions" ADD CONSTRAINT "listing_versions_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_images" ADD CONSTRAINT "listing_images_listingVersionId_fkey" FOREIGN KEY ("listingVersionId") REFERENCES "listing_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_images" ADD CONSTRAINT "listing_images_productAssetVersionId_fkey" FOREIGN KEY ("productAssetVersionId") REFERENCES "product_asset_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_files" ADD CONSTRAINT "listing_files_listingVersionId_fkey" FOREIGN KEY ("listingVersionId") REFERENCES "listing_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_files" ADD CONSTRAINT "listing_files_productAssetVersionId_fkey" FOREIGN KEY ("productAssetVersionId") REFERENCES "product_asset_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_proposals" ADD CONSTRAINT "price_proposals_listingVersionId_fkey" FOREIGN KEY ("listingVersionId") REFERENCES "listing_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_evaluations" ADD CONSTRAINT "seo_evaluations_listingVersionId_fkey" FOREIGN KEY ("listingVersionId") REFERENCES "listing_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_attempts" ADD CONSTRAINT "publication_attempts_listingVersionId_fkey" FOREIGN KEY ("listingVersionId") REFERENCES "listing_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
