import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { loadEnv } from '@ventureos/config';
import { prisma } from '@ventureos/database';
import { AuthAbuseService, type AuthClock } from '../src/modules/auth/auth-abuse.service';

class MutableClock implements AuthClock {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current);
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

/** Requires a migrated disposable PostgreSQL database. */
describe('durable authentication abuse control (integration)', () => {
  const loadedEnv = loadEnv();
  const env = {
    ...loadedEnv,
    AUTH_ABUSE_DIGEST_SECRET: `${loadedEnv.AUTH_ABUSE_DIGEST_SECRET ?? loadedEnv.AUTH_SECRET}:${randomUUID()}`,
  };
  const keyDigests = new Set<string>();
  let clock: MutableClock;
  let service: AuthAbuseService;

  function createContext(account: string, ip: string) {
    const context = service.createContext(account, ip);
    keyDigests.add(context.accountDigest);
    keyDigests.add(context.ipDigest);
    return context;
  }

  beforeEach(() => {
    clock = new MutableClock(new Date('2026-08-01T12:00:00.000Z'));
    service = new AuthAbuseService(env, clock);
  });

  afterAll(async () => {
    await prisma.authAbuseState.deleteMany({
      where: { keyDigest: { in: [...keyDigests] } },
    });
    await prisma.$disconnect();
  });

  it('applies the account threshold, survives a separate service instance, and expires cooldown', async () => {
    const context = createContext('account@example.test', '192.0.2.10');

    for (let attempt = 1; attempt < 5; attempt += 1) {
      await expect(service.recordAttempt('LOGIN', context)).resolves.toBeNull();
    }
    await expect(service.recordAttempt('LOGIN', context)).resolves.toEqual({
      reasonCode: 'LOGIN_ACCOUNT_COOLDOWN',
      retryAfterSeconds: 60,
    });

    const separateInstance = new AuthAbuseService(env, clock);
    await expect(separateInstance.getActiveBlock('LOGIN', context)).resolves.toEqual({
      reasonCode: 'LOGIN_ACCOUNT_COOLDOWN',
      retryAfterSeconds: 60,
    });

    clock.advance(61_000);
    await expect(separateInstance.getActiveBlock('LOGIN', context)).resolves.toBeNull();
    await expect(separateInstance.recordAttempt('LOGIN', context)).resolves.toBeNull();
  });

  it('applies the source-IP threshold across different account identifiers', async () => {
    let result = null;
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const context = createContext(`account-${attempt}@example.test`, '2001:db8::20');
      result = await service.recordAttempt('LOGIN', context);
    }

    expect(result).toEqual({ reasonCode: 'LOGIN_IP_COOLDOWN', retryAfterSeconds: 60 });
  });

  it('keeps the registration source-IP cooldown enforced across account identifiers', async () => {
    let result = null;
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const context = createContext(`registration-${attempt}@example.test`, '192.0.2.40');
      result = await service.recordAttempt('REGISTER', context);
    }

    expect(result).toEqual({ reasonCode: 'REGISTER_IP_COOLDOWN', retryAfterSeconds: 60 });
  });

  it('does not lose concurrent failure increments', async () => {
    const context = createContext('concurrent@example.test', '198.51.100.20');
    const separateInstance = new AuthAbuseService(env, clock);

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        (index % 2 === 0 ? service : separateInstance).recordAttempt('LOGIN', context),
      ),
    );

    const accountState = await prisma.authAbuseState.findUniqueOrThrow({
      where: {
        channel_scope_keyDigest: {
          channel: 'LOGIN',
          scope: 'ACCOUNT',
          keyDigest: context.accountDigest,
        },
      },
    });
    expect(accountState.attemptCount).toBe(5);
    expect(accountState.cooldownUntil).not.toBeNull();

    const ipState = await prisma.authAbuseState.findUniqueOrThrow({
      where: {
        channel_scope_keyDigest: {
          channel: 'LOGIN',
          scope: 'IP',
          keyDigest: context.ipDigest,
        },
      },
    });
    expect(ipState.attemptCount).toBe(5);
    expect(ipState.cooldownUntil).toBeNull();
    expect(
      results.filter((result) => result?.reasonCode === 'LOGIN_ACCOUNT_COOLDOWN'),
    ).toHaveLength(1);
  });

  it('clears only account state after successful authentication and preserves source-IP aging', async () => {
    const context = createContext('success@example.test', '203.0.113.20');
    await service.recordAttempt('LOGIN', context);

    await service.clearLoginAccount(context);

    expect(
      await prisma.authAbuseState.findUnique({
        where: {
          channel_scope_keyDigest: {
            channel: 'LOGIN',
            scope: 'ACCOUNT',
            keyDigest: context.accountDigest,
          },
        },
      }),
    ).toBeNull();
    expect(
      await prisma.authAbuseState.findUnique({
        where: {
          channel_scope_keyDigest: {
            channel: 'LOGIN',
            scope: 'IP',
            keyDigest: context.ipDigest,
          },
        },
      }),
    ).not.toBeNull();
  });

  it('deletes expired rows with a controllable clock', async () => {
    const context = createContext('expired@example.test', '192.0.2.30');
    await service.recordAttempt('LOGIN', context);
    await prisma.authAbuseState.updateMany({
      where: { keyDigest: { in: [context.accountDigest, context.ipDigest] } },
      data: { expiresAt: new Date('2026-07-31T00:00:00.000Z') },
    });

    await expect(service.cleanupExpired()).resolves.toBe(2);
    await expect(
      prisma.authAbuseState.count({
        where: { keyDigest: { in: [context.accountDigest, context.ipDigest] } },
      }),
    ).resolves.toBe(0);
  });

  it('does not let locked expired cleanup rows block the critical counter update', async () => {
    const expired = createContext('locked-expired@example.test', '192.0.2.31');
    await service.recordAttempt('LOGIN', expired);
    await prisma.authAbuseState.updateMany({
      where: { keyDigest: { in: [expired.accountDigest, expired.ipDigest] } },
      data: { expiresAt: new Date('2026-07-31T00:00:00.000Z') },
    });

    let signalLocked!: () => void;
    let releaseLock!: () => void;
    const locked = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const lockTransaction = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT "keyDigest"
          FROM "auth_abuse_states"
          WHERE "keyDigest" IN (${expired.accountDigest}, ${expired.ipDigest})
          FOR UPDATE
        `;
        signalLocked();
        await release;
      },
      { timeout: 30_000 },
    );

    await locked;
    try {
      const current = createContext('cleanup-independent@example.test', '192.0.2.32');
      await expect(service.recordAttempt('LOGIN', current)).resolves.toBeNull();
    } finally {
      releaseLock();
      await lockTransaction;
    }
  });
});
