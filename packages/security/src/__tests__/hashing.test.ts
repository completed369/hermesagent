import { describe, expect, it } from 'vitest';
import { hashContent, hashObject, canonicalJsonStringify } from '../hashing';

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
