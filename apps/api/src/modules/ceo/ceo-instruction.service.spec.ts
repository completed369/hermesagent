import { beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ founder: vi.fn(), query: vi.fn() }));
vi.mock('@ventureos/database', () => ({
  prisma: { workspaceMember: { findFirst: db.founder }, $queryRaw: db.query },
  Prisma: { sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }) },
}));
import { CeoInstructionService } from './ceo-instruction.service';
import type { AcpTaskRunService } from '../agent-control-plane/acp-task-run.service';

const workspace = '11111111-1111-4111-8111-111111111111';
describe('director instruction admission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it('rechecks founder membership and reads only a stored instruction in the bound workspace', async () => {
    db.founder.mockResolvedValue({ id: 'member' });
    db.query.mockResolvedValue([{ payload_digest: 'a'.repeat(64) }]);
    const createPlan = vi.fn(async (capability, context, plan) => {
      capability.assertSource('AI_COO');
      expect(capability.authorityLevelFor(context)).toBe(1);
      expect(context).toEqual({ workspaceId: workspace, principalId: 'owner' });
      return { objective: { id: plan.objective.id }, replayed: false };
    });
    const service = new CeoInstructionService({ createPlan } as unknown as AcpTaskRunService);
    expect(await service.prepare(workspace, 'owner', 'Ev123')).toContain(
      'No research or paid work has executed through this intake',
    );
    expect(db.founder).toHaveBeenCalledWith({
      where: {
        workspaceId: workspace,
        userId: 'owner',
        role: { key: 'FOUNDER' },
        user: { isFounder: true, deletedAt: null },
      },
    });
    expect(db.query.mock.calls[0]?.[0].values).toEqual([workspace, 'Ev123']);
    expect(createPlan).toHaveBeenCalledTimes(1);
  });
  it('denies revoked owners before accessing instructions or creating work', async () => {
    db.founder.mockResolvedValue(null);
    const createPlan = vi.fn();
    const service = new CeoInstructionService({ createPlan } as unknown as AcpTaskRunService);
    await expect(service.prepare(workspace, 'owner', 'Ev123')).rejects.toThrow(
      'no longer authorized',
    );
    expect(db.query).not.toHaveBeenCalled();
    expect(createPlan).not.toHaveBeenCalled();
  });
  it('denies an absent or other-workspace instruction without creating work', async () => {
    db.founder.mockResolvedValue({ id: 'member' });
    db.query.mockResolvedValue([]);
    const createPlan = vi.fn();
    const service = new CeoInstructionService({ createPlan } as unknown as AcpTaskRunService);
    await expect(service.prepare(workspace, 'owner', 'Ev123')).rejects.toThrow('not found');
    expect(createPlan).not.toHaveBeenCalled();
  });
});
