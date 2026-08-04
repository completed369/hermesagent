import { prisma } from '@ventureos/database';
import { hashObject } from '@ventureos/security';
import { IdempotencyKeyConflictError, MarketplaceAccountNotFoundError } from './errors.js';

export interface WithIdempotencyParams<T> {
  workspaceId: string;
  marketplaceAccountId: string;
  key: string;
  operationType: string;
  requestPayload: unknown;
  execute: () => Promise<T>;
  /** Revalidates current policy/local state before a cached success is reused. */
  beforeReplay?: () => Promise<void> | void;
  /** Runs only after a fresh/failed key is claimed and before external execution. */
  beforeExecute?: (claim: { idempotencyKeyId: string }) => Promise<void> | void;
  /** Runs synchronously as soon as external execution returns successfully. */
  onExecutionSuccess?: (result: T) => void;
}

export interface WithIdempotencyResult<T> {
  result: T;
  idempotencyKeyId: string;
  replayed: boolean;
}

/**
 * Serializes an external marketplace write per (workspaceId, key) and caches
 * successful responses. Provider-level idempotency remains necessary for the
 * crash window where the provider accepts a write before local success can be
 * persisted.
 *
 * - An existing row with a MATCHING requestHash and status SUCCEEDED replays
 *   the cached response instead of re-executing (a genuine retry).
 * - An existing row with a matching requestHash and status PENDING throws
 *   (a concurrent duplicate call currently in flight).
 * - An existing row with a DIFFERENT requestHash always throws -- key reuse
 *   for a different operation is a real caller bug, never treated as a
 *   retry of the same thing.
 * - An existing FAILED row is retried in place (same row transitions back
 *   to PENDING) rather than creating a second row for the same key.
 */
export async function withIdempotency<T>(
  params: WithIdempotencyParams<T>,
): Promise<WithIdempotencyResult<T>> {
  const account = await prisma.marketplaceAccount.findFirst({
    where: { id: params.marketplaceAccountId, workspaceId: params.workspaceId },
    select: { id: true },
  });
  if (!account) {
    throw new MarketplaceAccountNotFoundError(
      'Marketplace account was not found in this workspace',
    );
  }

  const requestHash = hashObject(params.requestPayload);

  const existing = await prisma.idempotencyKey.findUnique({
    where: { workspaceId_key: { workspaceId: params.workspaceId, key: params.key } },
  });

  if (
    existing &&
    (existing.marketplaceAccountId !== params.marketplaceAccountId ||
      existing.operationType !== params.operationType)
  ) {
    throw new IdempotencyKeyConflictError(
      `Idempotency key "${params.key}" was already bound to a different marketplace operation.`,
    );
  }

  if (existing && existing.requestHash !== requestHash) {
    throw new IdempotencyKeyConflictError(
      `Idempotency key "${params.key}" was already used for a different request payload -- this is a caller bug, not a retry.`,
    );
  }

  if (existing && existing.status === 'SUCCEEDED') {
    await params.beforeReplay?.();
    return {
      result: existing.responseSnapshot as T,
      idempotencyKeyId: existing.id,
      replayed: true,
    };
  }

  if (existing && existing.status === 'PENDING') {
    throw new IdempotencyKeyConflictError(
      `Idempotency key "${params.key}" already has a request in flight.`,
    );
  }

  let row;
  if (existing && existing.status === 'FAILED') {
    const claimed = await prisma.idempotencyKey.updateMany({
      where: { id: existing.id, status: 'FAILED' },
      data: { status: 'PENDING', completedAt: null },
    });
    if (claimed.count !== 1) {
      throw new IdempotencyKeyConflictError(
        `Idempotency key "${params.key}" already has a request in flight.`,
      );
    }
    row = { ...existing, status: 'PENDING' as const, completedAt: null };
  } else {
    row = await (async () => {
      try {
        return await prisma.idempotencyKey.create({
          data: {
            workspaceId: params.workspaceId,
            marketplaceAccountId: params.marketplaceAccountId,
            key: params.key,
            operationType: params.operationType,
            requestHash,
            status: 'PENDING',
          },
        });
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'P2002'
        ) {
          return null;
        }
        throw error;
      }
    })();

    if (!row) return withIdempotency(params);
  }

  let executionCompleted = false;
  try {
    await params.beforeExecute?.({ idempotencyKeyId: row.id });
    const result = await params.execute();
    executionCompleted = true;
    params.onExecutionSuccess?.(result);
    await prisma.idempotencyKey.update({
      where: { id: row.id },
      data: {
        status: 'SUCCEEDED',
        // Round-trip through JSON so only JSON-safe data is ever cached
        // in this Json column, regardless of what shape `execute()` returns.
        responseSnapshot: JSON.parse(JSON.stringify(result)),
        completedAt: new Date(),
      },
    });
    return { result, idempotencyKeyId: row.id, replayed: false };
  } catch (err) {
    // Once external execution returns successfully, keep the claim PENDING if
    // caching fails. Marking it FAILED would make a retry repeat the write.
    if (!executionCompleted) {
      await prisma.idempotencyKey.update({
        where: { id: row.id },
        data: { status: 'FAILED', completedAt: new Date() },
      });
    }
    throw err;
  }
}
