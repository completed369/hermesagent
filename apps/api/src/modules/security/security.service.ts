import { Injectable } from '@nestjs/common';
import { prisma } from '@ventureos/database';

@Injectable()
export class SecurityService {
  async list(workspaceId: string, limit = 100) {
    return prisma.securityEvent.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 500),
    });
  }
}
