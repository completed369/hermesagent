import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@ventureos/database';
import type { Env } from '@ventureos/config';
import { AuthAbuseService, type AuthClock } from './auth-abuse.service';

vi.mock('@ventureos/database', () => ({
  prisma: {
    authAbuseState: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      delete: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

const now = new Date('2026-08-01T12:00:00.000Z');
const clock: AuthClock = { now: () => now };
const env = { AUTH_SECRET: 'synthetic-auth-abuse-unit-secret' } as Env;

function row(overrides: Record<string, unknown> = {}) {
  return {
    channel: 'LOGIN',
    scope: 'ACCOUNT',
    keyDigest: 'a'.repeat(64),
    attemptCount: 5,
    windowStartedAt: new Date('2026-08-01T11:59:00.000Z'),
    cooldownLevel: 1,
    cooldownUntil: new Date('2026-08-01T12:01:00.000Z'),
    lastAttemptAt: now,
    expiresAt: new Date('2026-08-02T12:01:00.000Z'),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('AuthAbuseService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.authAbuseState.findMany).mockResolvedValue([]);
    vi.mocked(prisma.authAbuseState.deleteMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.$executeRaw).mockResolvedValue(0);
  });

  it('builds normalized one-way account and IP identifiers', () => {
    const service = new AuthAbuseService(env, clock);
    const first = service.createContext(' Founder@Example.TEST ', '::ffff:192.0.2.10');
    const second = service.createContext('founder@example.test', '192.0.2.10');

    expect(first).toEqual(second);
    expect(first.accountDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(first.ipDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(first)).not.toContain('founder@example.test');
    expect(JSON.stringify(first)).not.toContain('192.0.2.10');
  });

  it('uses the dedicated abuse digest secret when configured', () => {
    const shared = { ...env, AUTH_ABUSE_DIGEST_SECRET: 'a'.repeat(32) } as Env;
    const rotated = { ...env, AUTH_ABUSE_DIGEST_SECRET: 'b'.repeat(32) } as Env;

    expect(
      new AuthAbuseService(shared, clock).createContext('founder@example.test', '192.0.2.10'),
    ).not.toEqual(
      new AuthAbuseService(rotated, clock).createContext('founder@example.test', '192.0.2.10'),
    );
  });

  it('returns the longest active cooldown with an internal reason code', async () => {
    vi.mocked(prisma.authAbuseState.findMany).mockResolvedValue([
      row(),
      row({
        scope: 'IP',
        keyDigest: 'b'.repeat(64),
        cooldownUntil: new Date('2026-08-01T12:05:00.000Z'),
      }),
    ] as never);
    const service = new AuthAbuseService(env, clock);
    const context = service.createContext('founder@example.test', '192.0.2.10');

    await expect(service.getActiveBlock('LOGIN', context)).resolves.toEqual({
      reasonCode: 'LOGIN_IP_COOLDOWN',
      retryAfterSeconds: 300,
    });
  });

  it('atomically increments account and IP state without an interactive transaction', async () => {
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([row()])
      .mockResolvedValueOnce([
        row({ scope: 'IP', keyDigest: 'b'.repeat(64), cooldownUntil: null }),
      ]);
    vi.mocked(prisma.$transaction).mockImplementation(
      async (queries) => Promise.all(queries as never) as never,
    );
    const service = new AuthAbuseService(env, clock);
    const context = service.createContext('founder@example.test', '192.0.2.10');

    await expect(service.recordAttempt('LOGIN', context)).resolves.toEqual({
      reasonCode: 'LOGIN_ACCOUNT_COOLDOWN',
      retryAfterSeconds: 60,
    });
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(prisma.$transaction).toHaveBeenCalledWith([expect.any(Promise), expect.any(Promise)]);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(prisma.$executeRaw).toHaveBeenCalledOnce();
    expect(vi.mocked(prisma.$executeRaw).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(prisma.$transaction).mock.invocationCallOrder[0]!,
    );
  });

  it('uses only the source-IP scope for public registration to avoid arbitrary-account denial', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      row({ channel: 'REGISTER', scope: 'IP', keyDigest: 'b'.repeat(64), cooldownUntil: null }),
    ] as never);
    vi.mocked(prisma.$transaction).mockImplementation(
      async (queries) => Promise.all(queries as never) as never,
    );
    const service = new AuthAbuseService(env, clock);
    const context = service.createContext('victim@example.test', '192.0.2.10');

    await service.recordAttempt('REGISTER', context);

    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    expect(prisma.$executeRaw).toHaveBeenCalledOnce();
    expect(vi.mocked(prisma.$executeRaw).mock.calls[0]).toContain(now);
    expect(vi.mocked(prisma.$executeRaw).mock.calls[0]).toContain(500);
  });

  it('deletes expired state using the controllable clock', async () => {
    const service = new AuthAbuseService(env, clock);

    await service.cleanupExpired();

    expect(prisma.$executeRaw).toHaveBeenCalledOnce();
    expect(vi.mocked(prisma.$executeRaw).mock.calls[0]).toContain(now);
    expect(vi.mocked(prisma.$executeRaw).mock.calls[0]).toContain(500);
  });
});
