import { Injectable } from '@nestjs/common';
import { OperationalEventCapability } from '@ventureos/agent-control-plane';
import { Prisma, prisma } from '@ventureos/database';
import { AcpTaskRunService } from '../agent-control-plane/acp-task-run.service';
import { buildCeoInstructionPlan } from './ceo-instruction-plan';
import type { CeoBinding } from './ceo-command';
import { verifyCeoInstructionRecord, type CeoInstructionRecord } from './ceo-instruction-record';

@Injectable()
export class CeoInstructionService {
  constructor(private readonly taskRuns: AcpTaskRunService) {}

  async prepare(binding: CeoBinding, eventId: string): Promise<string> {
    const { workspaceId, founderId } = binding;
    // Identity is supplied by the server's verified Slack binding, never message text.
    const founder = await prisma.workspaceMember.findFirst({
      where: {
        workspaceId,
        userId: founderId,
        role: { key: 'FOUNDER' },
        user: { isFounder: true, deletedAt: null },
      },
    });
    if (!founder) throw new Error('Owner instruction binding is no longer authorized');
    const [instruction] = await prisma.$queryRaw<CeoInstructionRecord[]>(
      Prisma.sql`SELECT workspace_id,event_id,channel_id,command,instruction,payload_digest,
        founder_id,slack_team_id,slack_user_id,slack_app_id FROM ceo_slack_inbox
        WHERE workspace_id=${workspaceId}::uuid AND event_id=${eventId} AND command='instruction'`,
    );
    if (!instruction) throw new Error('Owner instruction not found in this workspace');
    const verified = verifyCeoInstructionRecord(instruction, binding, eventId);
    const plan = buildCeoInstructionPlan({
      workspaceId,
      eventId,
      payloadDigest: verified.digest,
    });
    const context = { workspaceId, principalId: founderId };
    const capability = OperationalEventCapability.issue('AI_COO', [
      { ...context, actorKind: 'HUMAN', authorityLevel: 1 },
    ]);
    // createPlan atomically persists the objective, project, task, run and events.
    // Its deterministic idempotency key recovers a crash before the Slack reply.
    const { objective } = await this.taskRuns.createPlan(capability, context, plan);
    return `Instruction ${eventId} has a durable research task under ${objective.id}. No research or paid work has executed through this intake. Execution requires an eligible verified research agent, current authority and a funded reservation; pause and stop remain effective.`;
  }
}
