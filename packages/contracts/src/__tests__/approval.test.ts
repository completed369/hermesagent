import { describe, expect, it } from 'vitest';
import { isApprovalValidForExecution } from '../approval';

const approval = {
  approvedArtifactVersionId: 'v1',
  approvedPackageHash: 'hash-abc',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

describe('isApprovalValidForExecution', () => {
  it('accepts a matching, unexpired approval', () => {
    const result = isApprovalValidForExecution(approval, {
      artifactVersionId: 'v1',
      packageHash: 'hash-abc',
    });
    expect(result.valid).toBe(true);
  });

  it('rejects a changed artifact version', () => {
    const result = isApprovalValidForExecution(approval, {
      artifactVersionId: 'v2',
      packageHash: 'hash-abc',
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('ARTIFACT_VERSION_MISMATCH');
  });

  it('rejects a changed package hash', () => {
    const result = isApprovalValidForExecution(approval, {
      artifactVersionId: 'v1',
      packageHash: 'hash-different',
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('PACKAGE_HASH_MISMATCH');
  });

  it('rejects an expired approval', () => {
    const expired = { ...approval, expiresAt: new Date(Date.now() - 1000).toISOString() };
    const result = isApprovalValidForExecution(expired, {
      artifactVersionId: 'v1',
      packageHash: 'hash-abc',
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('APPROVAL_EXPIRED');
  });
});
