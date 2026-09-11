import { beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ founder: vi.fn(), query: vi.fn() }));
vi.mock('@ventureos/database', () => ({
  prisma: { workspaceMember: { findFirst: db.founder }, $queryRaw: db.query },
  Prisma: { sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }) },
}));
import { CeoInstructionService } from './ceo-instruction.service';
import type { AcpTaskRunService } from '../agent-control-plane/acp-task-run.service';
import { acceptCeoMessage } from './ceo-command';

const workspace = '11111111-1111-4111-8111-111111111111';
const binding = {
  workspaceId: workspace,
  founderId: 'owner',
  slackTeamId: 'T123',
  slackUserId: 'U123',
  slackAppId: 'A123',
};
const message = acceptCeoMessage(
  {
    team_id: 'T123',
    api_app_id: 'A123',
    event_id: 'Ev123',
    event: {
      type: 'message',
      channel_type: 'im',
      user: 'U123',
      channel: 'D123',
      text: 'Research useful offers',
    },
  },
  binding,
)!;
const record = {
  workspace_id: workspace,
  event_id: message.eventId,
  channel_id: message.channel,
  command: message.command,
  instruction: message.instruction,
  payload_digest: message.digest,
  founder_id: 'owner',
  slack_team_id: 'T123',
  slack_user_id: 'U123',
  slack_app_id: 'A123',
};
describe('director instruction admission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it('rechecks founder membership and reads only a stored instruction in the bound workspace', async () => {
    db.founder.mockResolvedValue({ id: 'member' });
    db.query.mockResolvedValue([record]);
    const createPlan = vi.fn(async (capability, context, plan) => {
      capability.assertSource('AI_COO');
      expect(capability.authorityLevelFor(context)).toBe(1);
      expect(context).toEqual({ workspaceId: workspace, principalId: 'owner' });
      return { objective: { id: plan.objective.id }, replayed: false };
    });
    const service = new CeoInstructionService({ createPlan } as unknown as AcpTaskRunService);
    expect(await service.prepare(binding, 'Ev123')).toContain(
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
    expect(JSON.stringify(createPlan.mock.calls[0]?.[2])).not.toContain(message.instruction);
    expect(JSON.stringify(createPlan.mock.calls[0]?.[2])).toContain(message.digest);
  });
  it('denies revoked owners before accessing instructions or creating work', async () => {
    db.founder.mockResolvedValue(null);
    const createPlan = vi.fn();
    const service = new CeoInstructionService({ createPlan } as unknown as AcpTaskRunService);
    await expect(service.prepare(binding, 'Ev123')).rejects.toThrow('no longer authorized');
    expect(db.query).not.toHaveBeenCalled();
    expect(createPlan).not.toHaveBeenCalled();
  });
  it('denies an absent or other-workspace instruction without creating work', async () => {
    db.founder.mockResolvedValue({ id: 'member' });
    db.query.mockResolvedValue([]);
    const createPlan = vi.fn();
    const service = new CeoInstructionService({ createPlan } as unknown as AcpTaskRunService);
    await expect(service.prepare(binding, 'Ev123')).rejects.toThrow('not found');
    expect(createPlan).not.toHaveBeenCalled();
  });
  it.each([
    { instruction: 'Changed instruction' },
    { payload_digest: 'a'.repeat(64) },
    { founder_id: 'replacement-owner' },
    { slack_team_id: null, slack_user_id: null, slack_app_id: null, founder_id: null },
  ])('denies content or sender drift before durable task creation: %j', async (change) => {
    db.founder.mockResolvedValue({ id: 'member' });
    db.query.mockResolvedValue([{ ...record, ...change }]);
    const createPlan = vi.fn();
    const service = new CeoInstructionService({ createPlan } as unknown as AcpTaskRunService);
    await expect(service.prepare(binding, 'Ev123')).rejects.toThrow();
    expect(createPlan).not.toHaveBeenCalled();
  });
});
