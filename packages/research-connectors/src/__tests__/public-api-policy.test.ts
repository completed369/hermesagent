import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import * as publicApi from '../index.js';

const nodeRequire = createRequire(__filename);

describe('research-connectors public API policy', () => {
  it('does not expose raw research adapters', () => {
    expect(publicApi).not.toHaveProperty('fetchMockResearchResult');
  });

  it('rejects raw adapter deep imports', () => {
    expect(() =>
      nodeRequire.resolve('@ventureos/research-connectors/dist/mock-adapter.js'),
    ).toThrow();
  });
});
