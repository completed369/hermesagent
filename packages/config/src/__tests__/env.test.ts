import { describe, expect, it } from 'vitest';
import { envSchema, __resetEnvCacheForTests, loadEnv } from '../env';

describe('envSchema', () => {
  it('fails closed when DATABASE_URL is missing', () => {
    const result = envSchema.safeParse({ AUTH_SECRET: 'x'.repeat(32) });
    expect(result.success).toBe(false);
  });

  it('fails closed when AUTH_SECRET is too short', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://x',
      AUTH_SECRET: 'short',
    });
    expect(result.success).toBe(false);
  });

  it('applies safe defaults for optional values', () => {
    const result = envSchema.parse({
      DATABASE_URL: 'postgresql://localhost:5432/ventureos',
      AUTH_SECRET: 'x'.repeat(32),
    });
    expect(result.NODE_ENV).toBe('development');
    expect(result.AI_PROVIDER).toBe('mock');
    expect(result.FEATURE_LIVE_PUBLISHING_ENABLED).toBe(false);
    expect(result.GOVERNANCE_BOARD_APPROVAL_THRESHOLD).toBe(75);
  });

  it('memoizes loadEnv until reset', () => {
    __resetEnvCacheForTests();
    const env = loadEnv({
      DATABASE_URL: 'postgresql://localhost:5432/ventureos',
      AUTH_SECRET: 'x'.repeat(32),
    } as NodeJS.ProcessEnv);
    expect(env.APP_NAME).toBe('VentureOS');
    __resetEnvCacheForTests();
  });
});
