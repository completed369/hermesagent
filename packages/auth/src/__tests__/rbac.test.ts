import { describe, expect, it } from 'vitest';
import {
  requirePermission,
  hasPermission,
  ForbiddenError,
  type AuthorizationContext,
} from '../rbac';

const ctx: AuthorizationContext = {
  userId: 'u1',
  workspaceId: 'w1',
  permissions: new Set(['approval:decide']),
};

describe('RBAC', () => {
  it('allows a granted permission', () => {
    expect(() => requirePermission(ctx, 'approval:decide')).not.toThrow();
    expect(hasPermission(ctx, 'approval:decide')).toBe(true);
  });

  it('denies (fails closed) a missing permission', () => {
    expect(() => requirePermission(ctx, 'product:publish')).toThrow(ForbiddenError);
    expect(hasPermission(ctx, 'product:publish')).toBe(false);
  });
});
