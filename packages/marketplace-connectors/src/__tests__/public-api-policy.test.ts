import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import * as publicApi from '../index.js';

const nodeRequire = createRequire(__filename);

describe('marketplace-connectors public API policy', () => {
  it('does not expose raw marketplace adapter functions', () => {
    expect(publicApi).not.toHaveProperty('fetchMockPublishListing');
    expect(publicApi).not.toHaveProperty('fetchMockCreateDraftListing');
    expect(publicApi).not.toHaveProperty('withIdempotency');
  });

  it('rejects raw adapter and idempotency deep imports', () => {
    expect(() =>
      nodeRequire.resolve('@ventureos/marketplace-connectors/dist/mock-etsy-client.js'),
    ).toThrow();
    expect(() =>
      nodeRequire.resolve('@ventureos/marketplace-connectors/dist/idempotency.js'),
    ).toThrow();
  });
});
