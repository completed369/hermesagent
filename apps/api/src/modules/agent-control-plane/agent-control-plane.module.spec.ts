import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@ventureos/database', () => ({
  prisma: {},
  Prisma: {
    TransactionIsolationLevel: { Serializable: 'Serializable' },
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {},
    sql: vi.fn(),
  },
}));

import { AcpTaskRunService } from './acp-task-run.service';
import { AgentControlPlaneModule } from './agent-control-plane.module';
import { ConfigModule } from '../../config/config.module';
import { ENV_TOKEN } from '../../config/env.provider';

describe('AgentControlPlaneModule', () => {
  it('resolves the fail-closed task/run composition root', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, AgentControlPlaneModule],
    })
      .overrideProvider(ENV_TOKEN)
      .useValue({})
      .compile();

    expect(moduleRef.get(AcpTaskRunService)).toBeInstanceOf(AcpTaskRunService);
    await moduleRef.close();
  });
});
