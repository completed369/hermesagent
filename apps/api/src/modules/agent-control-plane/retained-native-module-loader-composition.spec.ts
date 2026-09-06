import type { BoundedLinuxRetainedNativeSupervisorModuleLoader } from '@ventureos/agent-bridge';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PostgresRetainedNativeModuleAuthorizationTrustComposition,
  type RetainedNativeModuleAuthorizationTrustTransactionClient,
} from './retained-native-module-authorization-trust-composition';
import { createPostgresRetainedDescriptorLinuxNativeSupervisorModuleLoader } from './retained-native-module-loader-composition';

const mocks = vi.hoisted(() => ({
  createLoader: vi.fn(),
}));

vi.mock('@ventureos/agent-bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ventureos/agent-bridge')>()),
  createRetainedDescriptorLinuxNativeSupervisorModuleLoader: mocks.createLoader,
}));

const database: RetainedNativeModuleAuthorizationTrustTransactionClient = {
  async $queryRaw<T = unknown>() {
    return [] as unknown as T;
  },
  async $transaction<T>(
    operation: (transaction: RetainedNativeModuleAuthorizationTrustTransactionClient) => Promise<T>,
  ) {
    return operation(database);
  },
};

describe('createPostgresRetainedDescriptorLinuxNativeSupervisorModuleLoader', () => {
  beforeEach(() => mocks.createLoader.mockReset());

  it('binds the real retained-descriptor loader only to scoped audited durable trust', () => {
    const loader = Object.freeze({}) as BoundedLinuxRetainedNativeSupervisorModuleLoader;
    mocks.createLoader.mockReturnValueOnce(loader);

    expect(
      createPostgresRetainedDescriptorLinuxNativeSupervisorModuleLoader(
        database,
        '00000000-0000-4000-8000-000000000001',
        'native-supervisor-1',
      ),
    ).toBe(loader);
    expect(mocks.createLoader).toHaveBeenCalledOnce();
    expect(mocks.createLoader).toHaveBeenCalledWith(
      expect.any(PostgresRetainedNativeModuleAuthorizationTrustComposition),
      Date.now,
    );
  });

  it('rejects unsafe scope before constructing a native loader', () => {
    expect(() =>
      createPostgresRetainedDescriptorLinuxNativeSupervisorModuleLoader(
        database,
        'workspace-secret-token',
        'native-supervisor-1',
      ),
    ).toThrow('Retained-native module authorization trust composition denied');
    expect(mocks.createLoader).not.toHaveBeenCalled();
  });
});
