import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  adapter: vi.fn(),
  assertWithinResearchCostCaps: vi.fn(),
  contractFindFirst: vi.fn(),
  dataSourceFindFirst: vi.fn(),
  dataSourceCreate: vi.fn(),
  evidenceArtifactCreate: vi.fn(),
  acquisitionRunCreate: vi.fn(),
  acquisitionRunUpdate: vi.fn(),
  acquisitionRunUpdateMany: vi.fn(),
  acquisitionRunCount: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  enforceWorkspaceCapability: vi.fn(),
  dispatchWithWorkspaceCapability: vi.fn(),
}));

vi.mock('@ventureos/database', () => ({
  CapabilityFinalCheckBlockedError: class CapabilityFinalCheckBlockedError extends Error {},
  CapabilityPolicyDeniedError: class CapabilityPolicyDeniedError extends Error {
    readonly decision: unknown;

    constructor(decision: unknown) {
      super('Operation is not available');
      this.name = 'CapabilityPolicyDeniedError';
      this.decision = decision;
    }
  },
  enforceWorkspaceCapability: mocks.enforceWorkspaceCapability,
  dispatchWithWorkspaceCapability: mocks.dispatchWithWorkspaceCapability,
  isCapabilityPolicyDeniedError: (error: unknown) =>
    error instanceof Error && error.name === 'CapabilityPolicyDeniedError',
  Prisma: { sql: vi.fn() },
  prisma: {
    dataAcquisitionContract: { findFirst: mocks.contractFindFirst },
    dataAcquisitionRun: {
      count: mocks.acquisitionRunCount,
      create: mocks.acquisitionRunCreate,
      update: mocks.acquisitionRunUpdate,
      updateMany: mocks.acquisitionRunUpdateMany,
    },
    dataSource: { findFirst: mocks.dataSourceFindFirst, create: mocks.dataSourceCreate },
    evidenceArtifact: { create: mocks.evidenceArtifactCreate },
    $transaction: mocks.transaction,
  },
}));

vi.mock('../mock-adapter.js', () => ({
  fetchMockResearchResult: mocks.adapter,
}));

vi.mock('../cost-guard.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../cost-guard.js')>();
  return {
    ...original,
    assertWithinResearchCostCaps: mocks.assertWithinResearchCostCaps,
  };
});

vi.mock('../health.js', () => ({
  slugifyContractName: (name: string) => name.toLowerCase().replaceAll(' ', '-'),
  writeResearchConnectorHealth: vi.fn(),
}));

import { CapabilityPolicyDeniedError } from '@ventureos/database';
import { runDataAcquisition } from '../acquisition-runner.js';
import { ResearchCostCapExceededError } from '../errors.js';

const validContract = {
  id: 'contract-a',
  workspaceId: 'workspace-a',
  name: 'Permitted source',
  sourceType: 'PERMITTED_BROWSER_RESEARCH',
  accessMethod: 'MANUAL_IMPORT',
  allowedOperations: ['READ_PUBLIC_LISTING_TITLE'],
  prohibitedOperations: ['BYPASS_AUTH'],
  failureHandling: 'FAIL_CLOSED',
  disabled: false,
  disabledReason: null,
  rateLimitPerMinute: null,
  rateLimitPerDay: null,
  costPerRunEurEstimate: { toString: () => '0' },
  freshnessRequirementHours: 24,
  termsOfUseNote: null,
  personalDataClassification: 'NONE',
};

function expectNoSuccessWrites() {
  expect(mocks.adapter).not.toHaveBeenCalled();
  expect(mocks.dataSourceCreate).not.toHaveBeenCalled();
  expect(mocks.evidenceArtifactCreate).not.toHaveBeenCalled();
  expect(mocks.acquisitionRunCreate).not.toHaveBeenCalled();
}

describe('research final-dispatch revalidation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    const tx = {
      $queryRaw: mocks.queryRaw,
      dataAcquisitionContract: { findFirst: mocks.contractFindFirst },
      dataAcquisitionRun: {
        findMany: vi.fn().mockResolvedValue([]),
        count: mocks.acquisitionRunCount,
        create: mocks.acquisitionRunCreate,
        update: mocks.acquisitionRunUpdate,
      },
      dataSource: { findFirst: mocks.dataSourceFindFirst, create: mocks.dataSourceCreate },
      evidenceArtifact: { create: mocks.evidenceArtifactCreate },
    };
    mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    );
    mocks.enforceWorkspaceCapability.mockResolvedValue(undefined);
    mocks.assertWithinResearchCostCaps.mockResolvedValue(undefined);
    mocks.adapter.mockReturnValue({ rawExcerpt: 'safe', items: [] });
    mocks.contractFindFirst.mockResolvedValue(validContract);
    mocks.acquisitionRunCreate.mockResolvedValue({ id: 'reserved-run', status: 'RESERVED' });
    mocks.dispatchWithWorkspaceCapability.mockImplementation(
      async (
        params: { beforeFinalCheck?: () => Promise<void> | void },
        dispatch: () => Promise<unknown> | unknown,
      ) => {
        try {
          await params.beforeFinalCheck?.();
        } catch (error) {
          if (
            error instanceof Error &&
            (error.name === 'ResearchRateLimitBlockedError' ||
              error.name === 'ResearchCostCapBlockedError')
          ) {
            throw error;
          }
          const { CapabilityPolicyDeniedError: Denial } = await import('@ventureos/database');
          throw new Denial({ reasonCode: 'POLICY_STATE_UNAVAILABLE' } as never);
        }
        return dispatch();
      },
    );
    mocks.acquisitionRunCount.mockResolvedValue(0);
  });

  it.each([
    ['contract removed', null],
    ['contract disabled', { ...validContract, disabled: true }],
    ['contract moved to another workspace', { ...validContract, workspaceId: 'workspace-b' }],
    ['allowed operations removed', { ...validContract, allowedOperations: [] }],
    ['source operation becomes unsupported', { ...validContract, sourceType: 'UNSUPPORTED' }],
  ])('denies when %s after admission', async (_label, finalContract) => {
    mocks.contractFindFirst
      .mockResolvedValueOnce(validContract)
      .mockResolvedValueOnce(finalContract);

    await expect(
      runDataAcquisition({ workspaceId: 'workspace-a', contractId: 'contract-a' }),
    ).rejects.toBeInstanceOf(CapabilityPolicyDeniedError);

    expect(mocks.contractFindFirst).toHaveBeenCalledTimes(2);
    expectNoSuccessWrites();
  });

  it('returns a truthful cost-cap block when the current cost limit is exhausted', async () => {
    mocks.contractFindFirst
      .mockResolvedValueOnce(validContract)
      .mockResolvedValueOnce(validContract);
    mocks.assertWithinResearchCostCaps
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ResearchCostCapExceededError('synthetic cost cap exhausted'));

    mocks.acquisitionRunCreate.mockResolvedValueOnce({
      id: 'cost-blocked-run',
      status: 'BLOCKED_COST_CAP',
    });

    const result = await runDataAcquisition({
      workspaceId: 'workspace-a',
      contractId: 'contract-a',
    });

    expect(result.status).toBe('BLOCKED_COST_CAP');
    expect(mocks.assertWithinResearchCostCaps).toHaveBeenCalledTimes(2);
    expect(mocks.acquisitionRunCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'BLOCKED_COST_CAP', costEur: 0 }),
    });
    expect(mocks.adapter).not.toHaveBeenCalled();
    expect(mocks.dataSourceCreate).not.toHaveBeenCalled();
    expect(mocks.evidenceArtifactCreate).not.toHaveBeenCalled();
  });

  it.each([
    'subscription revoked',
    'trial expired',
    'plan disabled',
    'entitlement removed',
    'provider selection changed',
    'policy lookup failed',
  ])('propagates final capability denial when %s after admission', async () => {
    const denial = new CapabilityPolicyDeniedError({
      reasonCode: 'POLICY_STATE_UNAVAILABLE',
    } as never);
    mocks.dispatchWithWorkspaceCapability.mockRejectedValueOnce(denial);

    await expect(
      runDataAcquisition({ workspaceId: 'workspace-a', contractId: 'contract-a' }),
    ).rejects.toBeInstanceOf(CapabilityPolicyDeniedError);

    expectNoSuccessWrites();
  });

  it('persists adapter metadata and charged cost from the final validated contract snapshot', async () => {
    const currentContract = {
      ...validContract,
      name: 'Current permitted source',
      costPerRunEurEstimate: { toString: () => '2.5' },
    };
    mocks.contractFindFirst
      .mockResolvedValueOnce(validContract)
      .mockResolvedValueOnce(currentContract);
    mocks.dataSourceFindFirst.mockResolvedValue({ id: 'source-a' });
    mocks.evidenceArtifactCreate.mockResolvedValue({ id: 'evidence-a' });
    mocks.acquisitionRunUpdate.mockResolvedValue({
      id: 'run-a',
      status: 'SUCCEEDED',
      evidenceArtifactId: 'evidence-a',
    });

    await runDataAcquisition({ workspaceId: 'workspace-a', contractId: 'contract-a' });

    expect(mocks.adapter).toHaveBeenCalledWith('Current permitted source', false);
    expect(mocks.evidenceArtifactCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ sourceName: 'Current permitted source' }),
    });
    expect(mocks.acquisitionRunUpdate).toHaveBeenCalledWith({
      where: { id: 'reserved-run' },
      data: expect.objectContaining({ costEur: 2.5 }),
    });
  });

  it('serializes and rechecks the minute rate limit before reserving provider work', async () => {
    const limitedContract = { ...validContract, rateLimitPerMinute: 1 };
    mocks.contractFindFirst.mockResolvedValue(limitedContract);
    mocks.acquisitionRunCount.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    mocks.acquisitionRunCreate.mockResolvedValueOnce({
      id: 'blocked-run',
      status: 'BLOCKED_RATE_LIMIT',
    });

    await expect(
      runDataAcquisition({ workspaceId: 'workspace-a', contractId: 'contract-a' }),
    ).resolves.toEqual(
      expect.objectContaining({ runId: 'blocked-run', status: 'BLOCKED_RATE_LIMIT' }),
    );

    expect(mocks.queryRaw).toHaveBeenCalledOnce();
    expect(mocks.adapter).not.toHaveBeenCalled();
  });

  it('records provider failures as operational failures, not policy denials', async () => {
    mocks.adapter.mockRejectedValueOnce(new Error('synthetic adapter outage'));

    await expect(
      runDataAcquisition({ workspaceId: 'workspace-a', contractId: 'contract-a' }),
    ).rejects.toThrow('synthetic adapter outage');

    expect(mocks.acquisitionRunUpdateMany).toHaveBeenCalledWith({
      where: { id: 'reserved-run', status: 'RESERVED' },
      data: expect.objectContaining({ status: 'FAILED' }),
    });
  });

  it('marks the reserved run failed when evidence persistence fails after provider success', async () => {
    mocks.dataSourceFindFirst.mockResolvedValue({ id: 'source-a' });
    mocks.evidenceArtifactCreate.mockRejectedValue(new Error('synthetic evidence write failure'));

    await expect(
      runDataAcquisition({ workspaceId: 'workspace-a', contractId: 'contract-a' }),
    ).rejects.toThrow('synthetic evidence write failure');

    expect(mocks.acquisitionRunUpdateMany).toHaveBeenCalledWith({
      where: { id: 'reserved-run', status: 'RESERVED' },
      data: expect.objectContaining({
        status: 'FAILED',
        blockedReason: 'Research result persistence failed',
      }),
    });
  });
});
