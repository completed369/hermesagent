import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Prisma, prisma } from '@ventureos/database';
import type { Env } from '@ventureos/config';
import { ENV_TOKEN } from '../../config/env.provider';
import {
  digestAuthIdentifier,
  normalizeAccountIdentifier,
  normalizeSourceIp,
} from './auth-identifiers';

export const AUTH_CLOCK = Symbol('AUTH_CLOCK');

export interface AuthClock {
  now(): Date;
}

export const systemAuthClock: AuthClock = { now: () => new Date() };

export type AuthChannel = 'LOGIN' | 'REGISTER';
export type AuthScope = 'ACCOUNT' | 'IP';

export interface AuthAbuseContext {
  accountDigest: string;
  ipDigest: string;
}

export interface AuthBlock {
  reasonCode: `${AuthChannel}_${AuthScope}_COOLDOWN`;
  retryAfterSeconds: number;
}

export class AuthCooldownException extends HttpException {
  readonly reasonCode: AuthBlock['reasonCode'];
  readonly retryAfterSeconds: number;

  constructor(block: AuthBlock) {
    super('Authentication temporarily unavailable', HttpStatus.TOO_MANY_REQUESTS);
    this.reasonCode = block.reasonCode;
    this.retryAfterSeconds = block.retryAfterSeconds;
  }
}

interface AuthAbusePolicy {
  windowMs: number;
  threshold: number;
}

export const AUTH_ABUSE_POLICIES: Partial<Record<`${AuthChannel}_${AuthScope}`, AuthAbusePolicy>> =
  {
    LOGIN_ACCOUNT: { windowMs: 15 * 60 * 1000, threshold: 5 },
    LOGIN_IP: { windowMs: 15 * 60 * 1000, threshold: 20 },
    REGISTER_IP: { windowMs: 60 * 60 * 1000, threshold: 10 },
  };

const RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_COOLDOWN_MS = 15 * 60 * 1000;
const CLEANUP_BATCH_SIZE = 500;

interface StoredAuthAbuseState {
  channel: AuthChannel;
  scope: AuthScope;
  keyDigest: string;
  attemptCount: number;
  windowStartedAt: Date;
  cooldownLevel: number;
  cooldownUntil: Date | null;
  lastAttemptAt: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class AuthAbuseService {
  constructor(
    @Inject(ENV_TOKEN) private readonly env: Env,
    @Inject(AUTH_CLOCK) private readonly clock: AuthClock,
  ) {}

  createContext(accountIdentifier: string, sourceIp: string): AuthAbuseContext {
    const account = normalizeAccountIdentifier(accountIdentifier);
    const ip = normalizeSourceIp(sourceIp);
    const digestSecret = this.env.AUTH_ABUSE_DIGEST_SECRET ?? this.env.AUTH_SECRET;
    return {
      accountDigest: digestAuthIdentifier('account', account, digestSecret),
      ipDigest: digestAuthIdentifier('ip', ip, digestSecret),
    };
  }

  async getActiveBlock(channel: AuthChannel, context: AuthAbuseContext): Promise<AuthBlock | null> {
    const now = this.clock.now();
    const keys = this.scopedKeys(channel, context);
    const rows = await prisma.authAbuseState.findMany({
      where: {
        channel,
        cooldownUntil: { gt: now },
        OR: keys.map(({ scope, keyDigest }) => ({ scope, keyDigest })),
      },
    });
    return this.blockFromRows(channel, rows as StoredAuthAbuseState[], now);
  }

  async recordAttempt(channel: AuthChannel, context: AuthAbuseContext): Promise<AuthBlock | null> {
    const now = this.clock.now();
    await this.deleteExpiredBatch(prisma, now);
    const resultSets = await prisma.$transaction(
      this.scopedKeys(channel, context).map(({ scope, keyDigest }) =>
        this.increment(prisma, channel, scope, keyDigest, now),
      ),
    );
    const rows = resultSets.map((result) => {
      const state = result[0];
      if (!state) throw new Error('Authentication abuse state update returned no row');
      return state;
    });
    return this.blockFromRows(channel, rows, now);
  }

  async clearLoginAccount(context: AuthAbuseContext): Promise<void> {
    await prisma.authAbuseState.deleteMany({
      where: {
        channel: 'LOGIN',
        scope: 'ACCOUNT',
        keyDigest: context.accountDigest,
      },
    });
  }

  async cleanupExpired(): Promise<number> {
    return this.deleteExpiredBatch(prisma, this.clock.now());
  }

  private deleteExpiredBatch(
    client: Pick<Prisma.TransactionClient, '$executeRaw'>,
    now: Date,
  ): Promise<number> {
    return client.$executeRaw`
      DELETE FROM "auth_abuse_states"
      WHERE ("channel", "scope", "keyDigest") IN (
        SELECT "channel", "scope", "keyDigest"
        FROM "auth_abuse_states"
        WHERE "expiresAt" <= ${now}
        ORDER BY "expiresAt" ASC
        LIMIT ${CLEANUP_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
    `;
  }

  private increment(
    client: Pick<Prisma.TransactionClient, '$queryRaw'>,
    channel: AuthChannel,
    scope: AuthScope,
    keyDigest: string,
    now: Date,
  ): Prisma.PrismaPromise<StoredAuthAbuseState[]> {
    const policy = AUTH_ABUSE_POLICIES[`${channel}_${scope}`];
    if (!policy) throw new Error(`Unsupported authentication abuse scope: ${channel}_${scope}`);
    const windowCutoff = new Date(now.getTime() - policy.windowMs);
    const expiresAt = new Date(now.getTime() + RETENTION_MS + MAX_COOLDOWN_MS);

    return client.$queryRaw<StoredAuthAbuseState[]>`
      INSERT INTO "auth_abuse_states" (
        "channel", "scope", "keyDigest", "attemptCount", "windowStartedAt",
        "cooldownLevel", "cooldownUntil", "lastAttemptAt", "expiresAt",
        "createdAt", "updatedAt"
      ) VALUES (
        ${channel}, ${scope}, ${keyDigest}, 1, ${now}, 0, NULL, ${now},
        ${expiresAt}, ${now}, ${now}
      )
      ON CONFLICT ("channel", "scope", "keyDigest") DO UPDATE SET
        "attemptCount" = CASE
          WHEN "auth_abuse_states"."cooldownUntil" > ${now}
            THEN "auth_abuse_states"."attemptCount"
          WHEN "auth_abuse_states"."cooldownUntil" IS NOT NULL
            OR "auth_abuse_states"."windowStartedAt" <= ${windowCutoff}
            THEN 1
          ELSE "auth_abuse_states"."attemptCount" + 1
        END,
        "windowStartedAt" = CASE
          WHEN "auth_abuse_states"."cooldownUntil" > ${now}
            THEN "auth_abuse_states"."windowStartedAt"
          WHEN "auth_abuse_states"."cooldownUntil" IS NOT NULL
            OR "auth_abuse_states"."windowStartedAt" <= ${windowCutoff}
            THEN ${now}
          ELSE "auth_abuse_states"."windowStartedAt"
        END,
        "cooldownLevel" = CASE
          WHEN "auth_abuse_states"."cooldownUntil" > ${now}
            THEN "auth_abuse_states"."cooldownLevel"
          WHEN (
            CASE
              WHEN "auth_abuse_states"."cooldownUntil" IS NOT NULL
                OR "auth_abuse_states"."windowStartedAt" <= ${windowCutoff}
                THEN 1
              ELSE "auth_abuse_states"."attemptCount" + 1
            END
          ) >= ${policy.threshold}
            THEN LEAST("auth_abuse_states"."cooldownLevel" + 1, 3)
          ELSE "auth_abuse_states"."cooldownLevel"
        END,
        "cooldownUntil" = CASE
          WHEN "auth_abuse_states"."cooldownUntil" > ${now}
            THEN "auth_abuse_states"."cooldownUntil"
          WHEN (
            CASE
              WHEN "auth_abuse_states"."cooldownUntil" IS NOT NULL
                OR "auth_abuse_states"."windowStartedAt" <= ${windowCutoff}
                THEN 1
              ELSE "auth_abuse_states"."attemptCount" + 1
            END
          ) >= ${policy.threshold}
            THEN CAST(${now} AS TIMESTAMP) + CASE LEAST("auth_abuse_states"."cooldownLevel" + 1, 3)
              WHEN 1 THEN INTERVAL '1 minute'
              WHEN 2 THEN INTERVAL '5 minutes'
              ELSE INTERVAL '15 minutes'
            END
          ELSE NULL
        END,
        "lastAttemptAt" = ${now},
        "expiresAt" = ${expiresAt},
        "updatedAt" = ${now}
      RETURNING *
    `;
  }

  private scopedKeys(
    channel: AuthChannel,
    context: AuthAbuseContext,
  ): Array<{ scope: AuthScope; keyDigest: string }> {
    const ip = { scope: 'IP' as const, keyDigest: context.ipDigest };
    if (channel === 'REGISTER') return [ip];
    return [{ scope: 'ACCOUNT', keyDigest: context.accountDigest }, ip];
  }

  private blockFromRows(
    channel: AuthChannel,
    rows: StoredAuthAbuseState[],
    now: Date,
  ): AuthBlock | null {
    const blocked = rows
      .filter((row) => row.cooldownUntil && row.cooldownUntil > now)
      .sort((left, right) => right.cooldownUntil!.getTime() - left.cooldownUntil!.getTime())[0];
    if (!blocked?.cooldownUntil) return null;

    return {
      reasonCode: `${channel}_${blocked.scope}_COOLDOWN`,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((blocked.cooldownUntil.getTime() - now.getTime()) / 1000),
      ),
    };
  }
}
