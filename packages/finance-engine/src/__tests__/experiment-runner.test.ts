import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@ventureos/database';
import { recordExperimentResult } from '../experiment-runner.js';
import { ExperimentInvalidStateError, ExperimentNotFoundError } from '../errors.js';

vi.mock('@ventureos/database', () => ({
  enforceWorkspaceCapability: vi.fn(),
  Prisma: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
  },
  prisma: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    experimentVariant: { findFirst: vi.fn() },
    experimentMetric: { findFirst: vi.fn() },
    experimentResult: { create: vi.fn() },
  },
}));

describe('recordExperimentResult', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) =>
      callback(prisma as never),
    );
    vi.mocked(prisma.experimentVariant.findFirst).mockResolvedValue({
      id: 'variant-a',
      experimentId: 'experiment-a',
      experiment: { workspaceId: 'workspace-a', status: 'RUNNING' },
    } as never);
    vi.mocked(prisma.experimentMetric.findFirst).mockResolvedValue(null);
  });

  it('rejects a metric that does not belong to the variant experiment', async () => {
    await expect(
      recordExperimentResult({
        workspaceId: 'workspace-a',
        experimentId: 'experiment-a',
        experimentVariantId: 'variant-a',
        experimentMetricId: 'metric-from-another-experiment',
        value: 42,
      }),
    ).rejects.toBeInstanceOf(ExperimentNotFoundError);

    expect(prisma.experimentMetric.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'metric-from-another-experiment',
        experimentId: 'experiment-a',
      },
    });
    expect(prisma.experimentResult.create).not.toHaveBeenCalled();
  });

  it('rejects a variant from a different route experiment', async () => {
    vi.mocked(prisma.experimentVariant.findFirst).mockResolvedValue({
      id: 'variant-b',
      experimentId: 'experiment-b',
      experiment: { workspaceId: 'workspace-a', status: 'RUNNING' },
    } as never);
    vi.mocked(prisma.experimentMetric.findFirst).mockResolvedValue({ id: 'metric-b' } as never);

    await expect(
      recordExperimentResult({
        workspaceId: 'workspace-a',
        experimentId: 'experiment-a',
        experimentVariantId: 'variant-b',
        experimentMetricId: 'metric-b',
        value: 42,
      }),
    ).rejects.toBeInstanceOf(ExperimentNotFoundError);

    expect(prisma.experimentResult.create).not.toHaveBeenCalled();
  });

  it('rejects result insertion after the experiment is decided', async () => {
    vi.mocked(prisma.experimentVariant.findFirst).mockResolvedValue({
      id: 'variant-a',
      experimentId: 'experiment-a',
      experiment: { workspaceId: 'workspace-a', status: 'DECIDED' },
    } as never);
    vi.mocked(prisma.experimentMetric.findFirst).mockResolvedValue({ id: 'metric-a' } as never);

    await expect(
      recordExperimentResult({
        workspaceId: 'workspace-a',
        experimentId: 'experiment-a',
        experimentVariantId: 'variant-a',
        experimentMetricId: 'metric-a',
        value: 42,
      }),
    ).rejects.toBeInstanceOf(ExperimentInvalidStateError);

    expect(prisma.experimentResult.create).not.toHaveBeenCalled();
  });
});
