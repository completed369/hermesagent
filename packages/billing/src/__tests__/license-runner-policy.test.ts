import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enforceWorkspaceCapability: vi.fn(),
  create: vi.fn(),
  findFirst: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock('@ventureos/database', () => ({
  enforceWorkspaceCapability: mocks.enforceWorkspaceCapability,
  prisma: {
    licenseKey: {
      create: mocks.create,
      findFirst: mocks.findFirst,
      updateMany: mocks.updateMany,
    },
  },
}));

import { issueLicenseKey, revokeLicenseKey } from '../license-runner.js';

describe('license mutator capability boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirst.mockResolvedValue({ workspaceId: 'workspace', status: 'ACTIVE' });
    mocks.enforceWorkspaceCapability.mockRejectedValue(new Error('Operation is not available'));
  });

  it('denies direct issue before license-key material is persisted', async () => {
    await expect(issueLicenseKey('workspace')).rejects.toThrow('Operation is not available');
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.enforceWorkspaceCapability).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'workspace', capability: 'LICENSE_EXPORT' }),
    );
  });

  it('denies direct revoke before mutation', async () => {
    await expect(revokeLicenseKey('workspace', 'license-id')).rejects.toThrow(
      'Operation is not available',
    );
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.enforceWorkspaceCapability).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'workspace', capability: 'LICENSE_EXPORT' }),
    );
  });
});
