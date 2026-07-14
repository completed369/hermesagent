-- AlterTable
ALTER TABLE "approval_requests" ADD COLUMN     "listingVersionId" UUID;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_listingVersionId_fkey" FOREIGN KEY ("listingVersionId") REFERENCES "listing_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
