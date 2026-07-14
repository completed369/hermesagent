import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { prisma } from '@ventureos/database';
import { loadEnv } from '@ventureos/config';
import { getTemporalClient } from '@ventureos/workflows';
import { AuditService } from '../audit/audit.service';

const BOARD_REVIEW_INCLUDE = {
  votes: { orderBy: { agentRole: 'asc' as const } },
  vetoes: true,
  decisionSummary: true,
};

/**
 * Starts/lists/reads board reviews. The actual review logic (running the 8
 * mock agents, computing the vote result, generating the Decision
 * Synthesiser summary) lives in @ventureos/agent-runtime and is executed by
 * the Temporal `boardApprovalWorkflow` (apps/worker), never inline in this
 * HTTP request -- board review is a durable, potentially long-running
 * (waits for founder approval) workflow, not a synchronous API call.
 */
@Injectable()
export class BoardService {
  constructor(private readonly auditService: AuditService) {}

  async startReview(workspaceId: string, ventureProposalId: string, actorId: string) {
    const proposal = await prisma.ventureProposal.findFirst({
      where: { id: ventureProposalId, workspaceId },
    });
    if (!proposal) {
      throw new NotFoundException('Venture proposal not found');
    }

    const env = loadEnv();
    const client = await getTemporalClient();
    const workflowId = `board-approval-${ventureProposalId}-${randomUUID()}`;
    const handle = await client.start('boardApprovalWorkflow', {
      taskQueue: env.TEMPORAL_TASK_QUEUE,
      workflowId,
      args: [{ workspaceId, ventureProposalId, actorId }],
    });

    await this.auditService.record(workspaceId, {
      actorId,
      action: 'BOARD_REVIEW_STARTED',
      entityType: 'VentureProposal',
      entityId: ventureProposalId,
      workflowId,
    });

    return { workflowId, temporalRunId: handle.firstExecutionRunId };
  }

  async listForProposal(workspaceId: string, ventureProposalId: string) {
    return prisma.boardReview.findMany({
      where: { workspaceId, ventureProposalId },
      orderBy: { createdAt: 'desc' },
      include: BOARD_REVIEW_INCLUDE,
    });
  }

  async getById(workspaceId: string, id: string) {
    const review = await prisma.boardReview.findFirst({
      where: { id, workspaceId },
      include: BOARD_REVIEW_INCLUDE,
    });
    if (!review) {
      throw new NotFoundException('Board review not found');
    }
    return review;
  }
}
