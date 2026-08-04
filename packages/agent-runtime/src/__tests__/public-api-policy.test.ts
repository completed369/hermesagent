import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import * as publicApi from '../index.js';

const nodeRequire = createRequire(__filename);

describe('agent-runtime public API policy', () => {
  it('does not expose the raw provider adapter', () => {
    expect(publicApi).not.toHaveProperty('runMockBoardAgent');
    expect(publicApi).not.toHaveProperty('runAllMockBoardAgents');
  });

  it('rejects raw provider deep imports', () => {
    expect(() => nodeRequire.resolve('@ventureos/agent-runtime/dist/mock-provider.js')).toThrow();
  });
});
