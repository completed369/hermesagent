import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  marketplaceAccountFindFirst: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock('@ventureos/database', () => ({
  prisma: {
    marketplaceAccount: {
      findFirst: mocks.marketplaceAccountFindFirst,
    },
    idempotencyKey: {
      findUnique: mocks.findUnique,
      create: mocks.create,
      update: mocks.update,
      updateMany: mocks.updateMany,
    },
  },
}));
vi.mock('@ventureos/security', () => ({ hashObject: () => 'request-hash' }));

import { withIdempotency } from '../idempotency.js';

const failedRow = {
  id: 'idempotency-row',
  status: 'FAILED',
  requestHash: 'request-hash',
  marketplaceAccountId: 'account',
  operationType: 'PUBLISH_LISTING',
  responseSnapshot: null,
};

describe('withIdempotency execution claim', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.marketplaceAccountFindFirst.mockResolvedValue({ id: 'account' });
    mocks.findUnique.mockResolvedValue(failedRow);
  });

  it('rejects a marketplace account owned by another workspace before claiming a key', async () => {
    mocks.marketplaceAccountFindFirst.mockResolvedValue(null);
    const execute = vi.fn();

    await expect(
      withIdempotency({
        workspaceId: 'workspace',
        marketplaceAccountId: 'foreign-account',
        key: 'publish:listing-version',
        operationType: 'PUBLISH_LISTING',
        requestPayload: { externalListingId: 'listing' },
        execute,
      }),
    ).rejects.toThrow('Marketplace account was not found in this workspace');

    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not execute when another retry has already claimed a FAILED row', async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    const execute = vi.fn();

    await expect(
      withIdempotency({
        workspaceId: 'workspace',
        marketplaceAccountId: 'account',
        key: 'publish:listing-version',
        operationType: 'PUBLISH_LISTING',
        requestPayload: { externalListingId: 'listing' },
        execute,
      }),
    ).rejects.toThrow('already has a request in flight');

    expect(execute).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([
    ['marketplace account', { marketplaceAccountId: 'other-account' }],
    ['operation type', { operationType: 'CREATE_DRAFT' }],
  ])('rejects reuse of a key bound to a different %s', async (_label, rowOverride) => {
    mocks.findUnique.mockResolvedValue({ ...failedRow, ...rowOverride });
    const execute = vi.fn();

    await expect(
      withIdempotency({
        workspaceId: 'workspace',
        marketplaceAccountId: 'account',
        key: 'publish:listing-version',
        operationType: 'PUBLISH_LISTING',
        requestPayload: { externalListingId: 'listing' },
        execute,
      }),
    ).rejects.toThrow('different marketplace operation');

    expect(execute).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('re-reads the winner when concurrent first-use creation loses the unique-key race', async () => {
    mocks.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...failedRow, status: 'PENDING' });
    mocks.create.mockRejectedValueOnce({ code: 'P2002' });
    const execute = vi.fn();

    await expect(
      withIdempotency({
        workspaceId: 'workspace',
        marketplaceAccountId: 'account',
        key: 'key',
        operationType: 'PUBLISH_LISTING',
        requestPayload: { listing: 'listing' },
        execute,
      }),
    ).rejects.toThrow('already has a request in flight');

    expect(mocks.findUnique).toHaveBeenCalledTimes(2);
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not run the fresh-execution hook for a cached success', async () => {
    mocks.findUnique.mockResolvedValue({
      ...failedRow,
      status: 'SUCCEEDED',
      responseSnapshot: { externalListingId: 'cached' },
    });
    const beforeExecute = vi.fn();
    const execute = vi.fn();

    const result = await withIdempotency({
      workspaceId: 'workspace',
      marketplaceAccountId: 'account',
      key: 'publish:listing-version',
      operationType: 'PUBLISH_LISTING',
      requestPayload: { externalListingId: 'listing' },
      beforeExecute,
      execute,
    });

    expect(result.replayed).toBe(true);
    expect(beforeExecute).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('runs the fresh-execution hook after claiming the key and before dispatch', async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.create.mockResolvedValue({ ...failedRow, status: 'PENDING' });
    const order: string[] = [];

    await withIdempotency({
      workspaceId: 'workspace',
      marketplaceAccountId: 'account',
      key: 'publish:listing-version',
      operationType: 'PUBLISH_LISTING',
      requestPayload: { externalListingId: 'listing' },
      beforeExecute: ({ idempotencyKeyId }) => {
        expect(idempotencyKeyId).toBe('idempotency-row');
        order.push('reserve');
      },
      execute: async () => {
        order.push('dispatch');
        return { externalListingId: 'published' };
      },
    });

    expect(order).toEqual(['reserve', 'dispatch']);
  });

  it('does not mark a key retryable after external execution succeeds but caching fails', async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.create.mockResolvedValue({ ...failedRow, status: 'PENDING' });
    mocks.update.mockRejectedValueOnce(new Error('response cache unavailable'));
    const execute = vi.fn().mockResolvedValue({ externalListingId: 'published' });
    const onExecutionSuccess = vi.fn();

    await expect(
      withIdempotency({
        workspaceId: 'workspace',
        marketplaceAccountId: 'account',
        key: 'publish:listing-version',
        operationType: 'PUBLISH_LISTING',
        requestPayload: { externalListingId: 'listing' },
        onExecutionSuccess,
        execute,
      }),
    ).rejects.toThrow('response cache unavailable');

    expect(execute).toHaveBeenCalledTimes(1);
    expect(onExecutionSuccess).toHaveBeenCalledWith({ externalListingId: 'published' });
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
});
