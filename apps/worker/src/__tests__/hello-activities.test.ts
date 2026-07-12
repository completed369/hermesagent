import { describe, expect, it } from 'vitest';
import { pingHealthActivity } from '../activities/hello-activities';

describe('pingHealthActivity', () => {
  it('returns a valid ISO timestamp', async () => {
    const result = await pingHealthActivity();
    expect(new Date(result).toISOString()).toBe(result);
  });
});
