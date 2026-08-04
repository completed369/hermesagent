import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  enforceFinanceMutation: vi.fn(),
  forecastCreate: vi.fn(),
  scenarioCreate: vi.fn(),
  approvalCreate: vi.fn(),
  experimentFindFirst: vi.fn(),
  approvalFindFirst: vi.fn(),
  proposalFindFirst: vi.fn(),
}));

const tx = {
  financialForecast: { create: mocks.forecastCreate },
  financialScenario: { create: mocks.scenarioCreate },
  approvalRequest: { create: mocks.approvalCreate },
};

vi.mock('@ventureos/database', () => ({
  Prisma: { sql: vi.fn() },
  prisma: {
    $transaction: mocks.transaction,
    experiment: { findFirst: mocks.experimentFindFirst },
    approvalRequest: { findFirst: mocks.approvalFindFirst, create: mocks.approvalCreate },
    ventureProposal: { findFirst: mocks.proposalFindFirst },
  },
}));
vi.mock('../capability-guard.js', () => ({
  enforceFinanceMutation: mocks.enforceFinanceMutation,
}));
vi.mock('../assumptions-runner.js', () => ({
  getActiveFinancialAssumption: vi.fn().mockResolvedValue({ id: 'assumption' }),
  upsertFinancialAssumption: vi.fn(),
  toFinancialAssumptions: vi.fn(() => ({})),
}));
vi.mock('../calculations.js', () => ({
  calculateBreakEven: vi.fn(() => ({
    breakEvenUnits: 1,
    breakEvenRevenueEur: 1,
    fixedCostsEur: 1,
  })),
  calculateScenarios: vi.fn(() =>
    ['LOW', 'BASE', 'HIGH'].map((scenario) => ({
      scenario,
      unitsSold: 1,
      grossRevenueEur: 1,
      netRevenueEur: 1,
      totalVariableCostEur: 1,
      fixedCostsEur: 1,
      grossProfitEur: 1,
      netProfitEur: 1,
    })),
  ),
}));
vi.mock('@ventureos/security', () => ({
  hashObject: vi.fn(() => 'hash'),
  hashScaleDecisionArtifact: vi.fn(() => 'scale-hash'),
}));

import { generateForecast } from '../forecast-runner.js';
import { requestScaleDecisionApproval } from '../experiment-runner.js';

describe('final finance transaction capability checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    );
    mocks.enforceFinanceMutation.mockImplementation(
      async (_workspaceId: string, _reference: string, client?: unknown) => {
        if (client !== undefined && client !== tx) {
          throw new Error('policy check used an unexpected transaction client');
        }
      },
    );
    mocks.forecastCreate.mockResolvedValue({ id: 'forecast' });
    mocks.scenarioCreate.mockImplementation(async ({ data }) => data);
    mocks.approvalCreate.mockResolvedValue({ id: 'approval' });
    mocks.experimentFindFirst.mockResolvedValue({
      id: 'experiment',
      workspaceId: 'workspace',
      ventureProposalId: 'proposal',
      name: 'experiment',
      hypothesis: 'test',
      status: 'RUNNING',
      listingVersionId: null,
      variants: [],
      metrics: [],
    });
    mocks.approvalFindFirst.mockResolvedValue(null);
    mocks.proposalFindFirst.mockResolvedValue({
      id: 'proposal',
      opportunity: { estimatedCostEur: 0, risks: [] },
      versions: [{ id: 'proposal-version', snapshot: {} }],
    });
  });

  it('checks finance capability inside the forecast write transaction', async () => {
    await expect(
      generateForecast({
        workspaceId: 'workspace',
        ventureProposalId: 'proposal',
        baseUnitsSold: 1,
      }),
    ).resolves.toMatchObject({ forecast: { id: 'forecast' } });

    expect(mocks.enforceFinanceMutation).toHaveBeenCalledWith(
      'workspace',
      'finance:forecast:proposal',
      tx,
    );
    expect(mocks.forecastCreate).toHaveBeenCalledOnce();
  });

  it('checks finance capability inside the scale-approval write transaction', async () => {
    await expect(
      requestScaleDecisionApproval({
        workspaceId: 'workspace',
        experimentId: 'experiment',
        requestedBy: 'founder',
        workflowId: 'workflow',
      }),
    ).resolves.toEqual({ approvalRequestId: 'approval' });

    expect(mocks.enforceFinanceMutation).toHaveBeenCalledWith(
      'workspace',
      'finance:scale-approval:experiment',
      tx,
    );
    expect(mocks.enforceFinanceMutation).toHaveBeenCalledWith(
      'workspace',
      'finance:scale-approval:experiment',
    );
    expect(mocks.enforceFinanceMutation).toHaveBeenCalledTimes(2);
    expect(mocks.approvalCreate).toHaveBeenCalledOnce();
  });
});
