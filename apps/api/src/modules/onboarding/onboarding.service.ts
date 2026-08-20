import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Prisma, prisma } from '@ventureos/database';
import type { OnboardingInput } from './onboarding.dto';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class OnboardingService {
  constructor(@Inject(AuditService) private readonly auditService: AuditService) {}

  async get(workspaceId: string, actorId: string) {
    return prisma.$transaction(async (tx) => {
      await assertFounderMembership(tx, workspaceId, actorId);
      return tx.founderOnboardingProfile.findUnique({ where: { workspaceId } });
    });
  }

  async save(workspaceId: string, input: OnboardingInput, actorId: string) {
    return prisma.$transaction(async (tx) => {
      await assertFounderMembership(tx, workspaceId, actorId);
      const before = await tx.founderOnboardingProfile.findUnique({ where: { workspaceId } });
      const after = await tx.founderOnboardingProfile.upsert({
        where: { workspaceId },
        update: { ...input, completedAt: new Date() },
        create: { workspaceId, ...input, completedAt: new Date() },
      });

      await this.auditService.record(
        workspaceId,
        {
          actorId,
          action: 'ONBOARDING_PROFILE_SAVED',
          entityType: 'FounderOnboardingProfile',
          entityId: workspaceId,
          before,
          after,
        },
        tx,
      );
      return after;
    });
  }
}

async function assertFounderMembership(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  actorId: string,
): Promise<void> {
  const founder = await tx.workspaceMember.findFirst({
    where: { workspaceId, userId: actorId, role: { key: 'FOUNDER' } },
    select: { id: true },
  });
  if (!founder) throw new ForbiddenException('Founder authority is required');
}
