import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  rootSubscriptionFindUnique: vi.fn(),
  queryRaw: vi.fn(),
  txSubscriptionFindUnique: vi.fn(),
  subscriptionUpdateMany: vi.fn(),
  subscriptionInvoiceCreate: vi.fn(),
  subscriptionFindUniqueOrThrow: vi.fn(),
}));

const tx = {
  $queryRaw: mocks.queryRaw,
  subscription: {
    findUnique: mocks.txSubscriptionFindUnique,
    updateMany: mocks.subscriptionUpdateMany,
    findUniqueOrThrow: mocks.subscriptionFindUniqueOrThrow,
  },
  subscriptionInvoice: { create: mocks.subscriptionInvoiceCreate },
};

vi.mock('@ventureos/database', () => ({
  Prisma: { sql: vi.fn((strings: TemplateStringsArray) => strings.join('?')) },
  prisma: {
    $transaction: mocks.transaction,
    subscription: { findUnique: mocks.rootSubscriptionFindUnique },
  },
}));

import { activateSubscription } from '../subscription-runner.js';

describe('subscription activation concurrency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    );
    mocks.txSubscriptionFindUnique.mockResolvedValue({
      id: 'subscription',
      workspaceId: 'workspace',
      status: 'TRIALING',
      plan: { priceMonthlyEur: 49 },
    });
    mocks.subscriptionUpdateMany.mockResolvedValue({ count: 1 });
    mocks.subscriptionFindUniqueOrThrow.mockResolvedValue({ id: 'subscription' });
  });

  it('locks and loads the current plan inside the invoice transaction', async () => {
    await activateSubscription('workspace');

    expect(mocks.rootSubscriptionFindUnique).not.toHaveBeenCalled();
    expect(mocks.queryRaw).toHaveBeenCalledOnce();
    expect(mocks.queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.txSubscriptionFindUnique.mock.invocationCallOrder[0]!,
    );
    expect(mocks.subscriptionInvoiceCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        subscriptionId: 'subscription',
        amountEur: 49,
      }),
    });
  });
});
