import { describe, it, expect } from 'vitest';
import {
  fetchMockCreateDraftListing,
  fetchMockUploadListingImage,
  fetchMockUploadListingFile,
  fetchMockPublishListing,
} from '../mock-etsy-client.js';

describe('mock-etsy-client', () => {
  it('creates a draft listing with a unique mock external id, never a real Etsy id shape', () => {
    const a = fetchMockCreateDraftListing({
      title: 'Test',
      description: 'Test description',
      tags: ['a', 'b'],
      priceEur: '2.99',
      isDigital: true,
    });
    const b = fetchMockCreateDraftListing({
      title: 'Test',
      description: 'Test description',
      tags: ['a', 'b'],
      priceEur: '2.99',
      isDigital: true,
    });
    expect(a.state).toBe('draft');
    expect(a.externalListingId).toMatch(/^mock-etsy-listing-/);
    // Two calls with identical input still produce distinct ids -- this is
    // NOT an idempotency guarantee (that lives in withIdempotency), just a
    // plain mock provider call.
    expect(a.externalListingId).not.toBe(b.externalListingId);
  });

  it('uploads a mock image and file, each with a distinct mock asset id', () => {
    const image = fetchMockUploadListingImage('mock-etsy-listing-abc', 0);
    const file = fetchMockUploadListingFile('mock-etsy-listing-abc', 'bundle.zip');
    expect(image.externalAssetId).toMatch(/^mock-etsy-image-/);
    expect(file.externalAssetId).toMatch(/^mock-etsy-file-/);
  });

  it('publishes a draft, returning a mock (never real) listing URL derived from its id', () => {
    const published = fetchMockPublishListing('mock-etsy-listing-xyz');
    expect(published.state).toBe('active');
    expect(published.externalListingId).toBe('mock-etsy-listing-xyz');
    expect(published.externalListingUrl).toBe(
      'https://mock.etsy.example/listing/mock-etsy-listing-xyz',
    );
  });
});
