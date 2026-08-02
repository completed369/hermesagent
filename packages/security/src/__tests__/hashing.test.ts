import { describe, expect, it } from 'vitest';
import {
  canonicalJsonStringify,
  hashContent,
  hashObject,
  hashProductListingBundle,
} from '../hashing';

describe('hashContent', () => {
  it('is deterministic for identical content', () => {
    expect(hashContent('hello')).toBe(hashContent('hello'));
  });
  it('differs for different content', () => {
    expect(hashContent('hello')).not.toBe(hashContent('hello!'));
  });
});

describe('canonicalJsonStringify', () => {
  it('produces identical output regardless of key order', () => {
    const a = canonicalJsonStringify({ b: 1, a: 2 });
    const b = canonicalJsonStringify({ a: 2, b: 1 });
    expect(a).toBe(b);
  });
});

describe('hashObject', () => {
  it('is stable across key order (so approvals bind to content, not encoding)', () => {
    expect(hashObject({ b: 1, a: 2 })).toBe(hashObject({ a: 2, b: 1 }));
  });
  it('changes when content changes (invalidating any bound approval)', () => {
    expect(hashObject({ a: 1 })).not.toBe(hashObject({ a: 2 }));
  });
});

describe('hashProductListingBundle', () => {
  const artifact = {
    assetVersionIds: ['asset-b', 'asset-a'],
    listing: {
      title: 'Title',
      description: 'Description',
      tags: ['beta', 'alpha'],
      category: 'templates',
      currency: 'EUR',
      priceEur: { toString: () => '10' },
    },
    images: [
      {
        id: 'image-b',
        productAssetVersionId: 'asset-image-b',
        position: 1,
        altText: null,
      },
      {
        id: 'image-a',
        productAssetVersionId: 'asset-image-a',
        position: 0,
        altText: 'Preview',
      },
    ],
    files: [
      {
        id: 'file-a',
        productAssetVersionId: 'asset-file-a',
        displayName: 'download.zip',
      },
    ],
  };

  it('is stable across asset and tag ordering', () => {
    expect(hashProductListingBundle(artifact)).toBe(
      hashProductListingBundle({
        ...artifact,
        assetVersionIds: [...artifact.assetVersionIds].reverse(),
        listing: { ...artifact.listing, tags: [...artifact.listing.tags].reverse() },
      }),
    );
  });

  it('invalidates approval evidence when mutable listing content changes', () => {
    expect(hashProductListingBundle(artifact)).not.toBe(
      hashProductListingBundle({
        ...artifact,
        listing: { ...artifact.listing, title: 'Changed title' },
      }),
    );
  });

  it.each([
    ['category', 'printables'],
    ['currency', 'USD'],
  ] as const)('invalidates approval evidence when listing %s changes', (field, value) => {
    expect(hashProductListingBundle(artifact)).not.toBe(
      hashProductListingBundle({
        ...artifact,
        listing: { ...artifact.listing, [field]: value },
      }),
    );
  });

  it('invalidates approval evidence when an attachment mapping changes', () => {
    expect(hashProductListingBundle(artifact)).not.toBe(
      hashProductListingBundle({
        ...artifact,
        files: [{ ...artifact.files[0]!, displayName: 'changed-name.zip' }],
      }),
    );
  });
});
