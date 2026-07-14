import { prisma } from '@ventureos/database';
import { hashObject } from '@ventureos/security';
import { IdempotencyKeyConflictError } from './errors.js';

export interface WithIdempotencyParams<T> {
  workspaceId: string;
  marketplaceAccountId: string;
  key: string;
  operationType: string;
  requestPayload: unknown;
  execute: () => Promise<T>;
}

export interface WithIdempotencyResult<T> {
  result: T;
  idempotencyKeyId: string;
  replayed: boolean;
}

/**
 * Guarantees an external marketplace write executes at most once per
 * (workspaceId, key), addressing docs/THREAT_MODEL.md's "duplicate external
 * execution" threat (previously "Not yet addressed") for real.
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
  const requestHash = hashObject(params.requestPayload);

  const existing = await prisma.idempotencyKey.findUnique({
    where: { workspaceId_key: { workspaceId: params.workspaceId, key: params.key } },
  });

  if (existing && existing.requestHash !== requestHash) {
    throw new IdempotencyKeyConflictError(
      `Idempotency key "${params.key}" was already used for a different request payload -- this is a caller bug, not a retry.`,
    );
  }

  if (existing && existing.status === 'SUCCEEDED') {
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

  const row =
    existing && existing.status === 'FAILED'
      ? await prisma.idempotencyKey.update({
          where: { id: existing.id },
          data: { status: 'PENDING', completedAt: null },
        })
      : await prisma.idempotencyKey.create({
          data: {
            workspaceId: params.workspaceId,
            marketplaceAccountId: params.marketplaceAccountId,
            key: params.key,
            operationType: params.operationType,
            requestHash,
            status: 'PENDING',
          },
        });

  try {
    const result = await params.execute();
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
    await prisma.idempotencyKey.update({
      where: { id: row.id },
      data: { status: 'FAILED', completedAt: new Date() },
    });
    throw err;
  }
}
