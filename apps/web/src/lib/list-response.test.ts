import { describe, expect, it } from 'vitest';
import { resolveListResponse } from '@/lib/list-response';

describe('dashboard list response state', () => {
  it.each([401, 403, 429, 500])('fails closed for HTTP %s', (status) => {
    expect(resolveListResponse(null, status)).toEqual({ kind: 'unavailable', items: [] });
  });

  it('does not treat a malformed successful response as an empty list', () => {
    expect(resolveListResponse(null, 200)).toEqual({ kind: 'unavailable', items: [] });
  });

  it('distinguishes a successful empty list from available records', () => {
    expect(resolveListResponse([], 200).kind).toBe('empty');
    expect(resolveListResponse([{ id: 'item-1' }], 200)).toEqual({
      kind: 'ready',
      items: [{ id: 'item-1' }],
    });
  });
});
