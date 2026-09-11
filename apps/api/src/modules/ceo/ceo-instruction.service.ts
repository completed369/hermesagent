import { Injectable } from '@nestjs/common';
import { OperationalEventCapability } from '@ventureos/agent-control-plane';
import { Prisma, prisma } from '@ventureos/database';
import { AcpTaskRunService } from '../agent-control-plane/acp-task-run.service';
import { buildCeoInstructionPlan } from './ceo-instruction-plan';

@Injectable()
export class CeoInstructionService {
  constructor(private readonly taskRuns: AcpTaskRunService) {}

  async prepare(workspaceId: string, founderId: string, eventId: string): Promise<string> {
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
    const [instruction] = await prisma.$queryRaw<Array<{ payload_digest: string }>>(
      Prisma.sql`SELECT payload_digest FROM ceo_slack_inbox
        WHERE workspace_id=${workspaceId}::uuid AND event_id=${eventId} AND command='instruction'`,
    );
    if (!instruction) throw new Error('Owner instruction not found in this workspace');
    const plan = buildCeoInstructionPlan({
      workspaceId,
      eventId,
      payloadDigest: instruction.payload_digest,
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
