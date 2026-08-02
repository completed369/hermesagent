import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashScaleDecisionArtifact } from '@ventureos/security';

const mocks = vi.hoisted(() => ({
  enforceFinanceMutation: vi.fn(),
  enforceFinanceRead: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  proposalFindFirst: vi.fn(),
  assumptionFindFirst: vi.fn(),
  assumptionUpdateMany: vi.fn(),
  assumptionCreate: vi.fn(),
  experimentCreate: vi.fn(),
  experimentFindFirst: vi.fn(),
  experimentUpdateMany: vi.fn(),
  experimentFindUniqueOrThrow: vi.fn(),
  experimentDecisionCreate: vi.fn(),
  approvalRequestFindFirst: vi.fn(),
}));

const tx = {
  $queryRaw: mocks.queryRaw,
  ventureProposal: { findFirst: mocks.proposalFindFirst },
  listingVersion: { findFirst: vi.fn() },
  financialAssumption: {
    findFirst: mocks.assumptionFindFirst,
    updateMany: mocks.assumptionUpdateMany,
    create: mocks.assumptionCreate,
  },
  experiment: {
    create: mocks.experimentCreate,
    findFirst: mocks.experimentFindFirst,
    updateMany: mocks.experimentUpdateMany,
    findUniqueOrThrow: mocks.experimentFindUniqueOrThrow,
  },
  approvalRequest: { findFirst: mocks.approvalRequestFindFirst },
  experimentDecision: { create: mocks.experimentDecisionCreate },
};

vi.mock('../capability-guard.js', () => ({
  enforceFinanceMutation: mocks.enforceFinanceMutation,
  enforceFinanceRead: mocks.enforceFinanceRead,
}));
vi.mock('@ventureos/database', () => ({
  Prisma: { sql: vi.fn((strings: TemplateStringsArray) => strings.join('?')) },
  prisma: { $transaction: mocks.transaction },
}));

import { getActiveFinancialAssumption, upsertFinancialAssumption } from '../assumptions-runner.js';
import { assertWithinBudget, resolveBudgetAllocation } from '../budget-guard.js';
import {
  createExperiment,
  recordExperimentDecision,
  requestScaleDecisionApproval,
  startExperiment,
} from '../experiment-runner.js';

describe('direct finance mutator capability boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    );
    mocks.enforceFinanceMutation.mockRejectedValue(new Error('Operation is not available'));
    mocks.enforceFinanceRead.mockRejectedValue(new Error('Operation is not available'));
    mocks.proposalFindFirst.mockResolvedValue({ id: 'proposal' });
    mocks.assumptionFindFirst.mockResolvedValue(null);
    mocks.experimentFindFirst.mockResolvedValue({
      id: 'experiment',
      status: 'DRAFT',
      workspaceId: 'workspace',
    });
  });

  it('denies direct financial-assumption creation inside its transaction before mutation', async () => {
    await expect(
      upsertFinancialAssumption({ workspaceId: 'workspace', ventureProposalId: 'proposal' }),
    ).rejects.toThrow('Operation is not available');
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.assumptionCreate).not.toHaveBeenCalled();
  });

  it('denies direct financial-assumption reads before database access', async () => {
    await expect(getActiveFinancialAssumption('workspace', 'proposal')).rejects.toThrow(
      'Operation is not available',
    );
    expect(mocks.assumptionFindFirst).not.toHaveBeenCalled();
  });

  it.each([
    ['budget capacity', () => assertWithinBudget('workspace', 'allocation', 1)],
    ['budget resolution', () => resolveBudgetAllocation('workspace', 'RESEARCH')],
  ])('denies direct %s reads before database access', async (_label, read) => {
    await expect(read()).rejects.toThrow('Operation is not available');
  });

  it('denies direct experiment creation before mutation', async () => {
    await expect(
      createExperiment({
        workspaceId: 'workspace',
        ventureProposalId: 'proposal',
        name: 'test',
        hypothesis: 'test',
        variants: [],
        metrics: [],
      }),
    ).rejects.toThrow('Operation is not available');
    expect(mocks.experimentCreate).not.toHaveBeenCalled();
  });

  it('denies direct experiment update before mutation', async () => {
    await expect(startExperiment('workspace', 'experiment')).rejects.toThrow(
      'Operation is not available',
    );
    expect(mocks.experimentUpdateMany).not.toHaveBeenCalled();
  });

  it('denies scale-approval replay before reading experiment or pending-request state', async () => {
    mocks.approvalRequestFindFirst.mockResolvedValue({ id: 'pending-approval' });

    await expect(
      requestScaleDecisionApproval({
        workspaceId: 'workspace',
        experimentId: 'experiment',
        requestedBy: 'founder',
        workflowId: 'workflow',
      }),
    ).rejects.toThrow('Operation is not available');

    expect(mocks.experimentFindFirst).not.toHaveBeenCalled();
    expect(mocks.approvalRequestFindFirst).not.toHaveBeenCalled();
  });

  it('denies direct experiment decision before mutation', async () => {
    mocks.experimentFindFirst.mockResolvedValue({ id: 'experiment', status: 'RUNNING' });
    await expect(
      recordExperimentDecision({
        workspaceId: 'workspace',
        experimentId: 'experiment',
        decision: 'HOLD',
        rationale: 'test',
        decidedBy: 'founder',
      }),
    ).rejects.toThrow('Operation is not available');
    expect(mocks.experimentDecisionCreate).not.toHaveBeenCalled();
  });

  it.each([
    ['expired', new Date('2000-01-01T00:00:00.000Z'), 'current-hash'],
    ['artifact-drifted', new Date('2099-01-01T00:00:00.000Z'), 'stale-hash'],
  ])('denies SCALE with %s approval evidence before mutation', async (_label, expiresAt, hash) => {
    mocks.enforceFinanceMutation.mockResolvedValue(undefined);
    mocks.experimentFindFirst.mockResolvedValue({
      id: 'experiment',
      name: 'pricing test',
      hypothesis: 'variant improves conversion',
      status: 'RUNNING',
      listingVersionId: null,
      ventureProposalId: 'proposal',
      variants: [],
      metrics: [],
    });
    mocks.proposalFindFirst.mockResolvedValue({
      id: 'proposal',
      versions: [{ id: 'version', snapshot: { current: true } }],
    });
    mocks.approvalRequestFindFirst.mockResolvedValue({
      id: 'approval',
      state: 'APPROVED',
      decisions: [
        {
          approvedArtifactVersionId: 'version',
          approvedPackageHash: hash,
          expiresAt,
        },
      ],
    });

    await expect(
      recordExperimentDecision({
        workspaceId: 'workspace',
        experimentId: 'experiment',
        decision: 'SCALE',
        rationale: 'test',
        decidedBy: 'founder',
        approvalRequestId: 'approval',
      }),
    ).rejects.toThrow('approval is no longer valid');

    expect(mocks.experimentUpdateMany).not.toHaveBeenCalled();
    expect(mocks.experimentDecisionCreate).not.toHaveBeenCalled();
  });

  it('denies SCALE when experiment results changed after founder approval', async () => {
    mocks.enforceFinanceMutation.mockResolvedValue(undefined);
    const measuredAt = new Date('2026-08-02T00:00:00.000Z');
    const currentExperiment = {
      id: 'experiment',
      name: 'pricing test',
      hypothesis: 'variant improves conversion',
      status: 'RUNNING',
      listingVersionId: null,
      ventureProposalId: 'proposal',
      variants: [
        {
          id: 'variant',
          name: 'control',
          description: null,
          isControl: true,
          trafficAllocationPercent: null,
          results: [
            {
              id: 'result',
              experimentMetricId: 'metric',
              value: { toString: () => '2' },
              sampleSize: 100,
              measuredAt,
            },
          ],
        },
      ],
      metrics: [{ id: 'metric', name: 'conversion', targetValue: null, unit: 'percent' }],
    };
    const approvedExperiment = {
      ...currentExperiment,
      variants: [
        {
          ...currentExperiment.variants[0]!,
          results: [{ ...currentExperiment.variants[0]!.results[0]!, value: '1' }],
        },
      ],
    };
    mocks.experimentFindFirst.mockResolvedValue(currentExperiment);
    mocks.proposalFindFirst.mockResolvedValue({
      id: 'proposal',
      versions: [{ id: 'version', snapshot: { current: true } }],
    });
    mocks.approvalRequestFindFirst.mockResolvedValue({
      id: 'approval',
      state: 'APPROVED',
      decisions: [
        {
          approvedArtifactVersionId: 'version',
          approvedPackageHash: hashScaleDecisionArtifact({
            proposalVersionId: 'version',
            proposalSnapshot: { current: true },
            experiment: approvedExperiment,
          }),
          expiresAt: new Date('2099-01-01T00:00:00.000Z'),
        },
      ],
    });

    await expect(
      recordExperimentDecision({
        workspaceId: 'workspace',
        experimentId: 'experiment',
        decision: 'SCALE',
        rationale: 'test',
        decidedBy: 'founder',
        approvalRequestId: 'approval',
      }),
    ).rejects.toThrow('approval is no longer valid');
    expect(mocks.experimentUpdateMany).not.toHaveBeenCalled();
  });
});
