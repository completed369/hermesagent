import { Injectable } from '@nestjs/common';
import { prisma } from '@ventureos/database';
import type { OnboardingInput } from './onboarding.dto';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class OnboardingService {
  constructor(private readonly auditService: AuditService) {}

  async get(workspaceId: string) {
    return prisma.founderOnboardingProfile.findUnique({ where: { workspaceId } });
  }

  async save(workspaceId: string, input: OnboardingInput, actorId: string) {
    const before = await prisma.founderOnboardingProfile.findUnique({ where: { workspaceId } });

    const after = await prisma.founderOnboardingProfile.upsert({
      where: { workspaceId },
      update: { ...input, completedAt: new Date() },
      create: { workspaceId, ...input, completedAt: new Date() },
    });

    await this.auditService.record(workspaceId, {
      actorId,
      action: 'ONBOARDING_PROFILE_SAVED',
      entityType: 'FounderOnboardingProfile',
      entityId: workspaceId,
      before,
      after,
    });

    return after;
  }
}
