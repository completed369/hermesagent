import { Test } from '@nestjs/testing';
import {
  DenyRuntimeProcessLauncher,
  DenyTrustedSupervisorAuthorizationSource,
  RUNTIME_PROCESS_LAUNCHER,
  TRUSTED_SUPERVISOR_AUTHORIZATION_SOURCE,
  TrustedSupervisorComposition,
} from '@ventureos/agent-bridge';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@ventureos/database', () => ({
  prisma: {},
  Prisma: {
    TransactionIsolationLevel: { Serializable: 'Serializable' },
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {},
    sql: vi.fn(),
  },
}));

import { AgentControlPlaneModule } from './agent-control-plane.module';
import { AcpTaskRunService } from './acp-task-run.service';
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
    expect(moduleRef.get(TrustedSupervisorComposition)).toBeInstanceOf(
      TrustedSupervisorComposition,
    );
    expect(moduleRef.get(TRUSTED_SUPERVISOR_AUTHORIZATION_SOURCE)).toBeInstanceOf(
      DenyTrustedSupervisorAuthorizationSource,
    );
    expect(moduleRef.get(RUNTIME_PROCESS_LAUNCHER)).toBeInstanceOf(DenyRuntimeProcessLauncher);
    await moduleRef.close();
  });
});
