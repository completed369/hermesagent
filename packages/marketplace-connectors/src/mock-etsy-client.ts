import { randomUUID } from 'node:crypto';

/**
 * The ONLY provider implemented in Phase 6 -- no live network calls exist
 * anywhere in this package (founder decision, recorded 2026-07-14: continue
 * mock-only). Method shapes deliberately mirror the real Etsy Open API v3
 * flow documented in docs/ETSY_API_INTEGRATION.md (createDraftListing ->
 * uploadListingImage/uploadListingFile -> updateListing state=active), so a
 * later real adapter is a drop-in behind the same interface, never a
 * rewrite of the orchestration around it.
 */

export interface MockCreateDraftListingInput {
  title: string;
  description: string;
  tags: string[];
  priceEur: string;
  isDigital: boolean;
}

export interface MockCreateDraftListingResult {
  externalListingId: string;
  state: 'draft';
}

export function fetchMockCreateDraftListing(
  input: MockCreateDraftListingInput,
): MockCreateDraftListingResult {
  void input;
  return {
    externalListingId: `mock-etsy-listing-${randomUUID()}`,
    state: 'draft',
  };
}

export interface MockUploadAssetResult {
  externalAssetId: string;
}

export function fetchMockUploadListingImage(
  externalListingId: string,
  position: number,
): MockUploadAssetResult {
  void externalListingId;
  void position;
  return { externalAssetId: `mock-etsy-image-${randomUUID()}` };
}

export function fetchMockUploadListingFile(
  externalListingId: string,
  displayName: string,
): MockUploadAssetResult {
  void externalListingId;
  void displayName;
  return { externalAssetId: `mock-etsy-file-${randomUUID()}` };
}

export interface MockPublishListingResult {
  externalListingId: string;
  externalListingUrl: string;
  state: 'active';
}

export function fetchMockPublishListing(externalListingId: string): MockPublishListingResult {
  return {
    externalListingId,
    externalListingUrl: `https://mock.etsy.example/listing/${externalListingId}`,
    state: 'active',
  };
}
