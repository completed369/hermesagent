import { Injectable } from '@nestjs/common';
import { prisma } from '@ventureos/database';
import type { OnboardingInput } from './onboarding.dto';

@Injectable()
export class OnboardingService {
  async get(workspaceId: string) {
    return prisma.founderOnboardingProfile.findUnique({ where: { workspaceId } });
  }

  async save(workspaceId: string, input: OnboardingInput) {
    return prisma.founderOnboardingProfile.upsert({
      where: { workspaceId },
      update: { ...input, completedAt: new Date() },
      create: { workspaceId, ...input, completedAt: new Date() },
    });
  }
}
