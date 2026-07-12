/**
 * Server-side RBAC check. This MUST be called on every sensitive API route -
 * a frontend button being hidden is never sufficient authorization.
 */
export interface AuthorizationContext {
  userId: string;
  workspaceId: string;
  permissions: Set<string>;
}

export class ForbiddenError extends Error {
  constructor(permission: string) {
    super(`Forbidden: missing permission "${permission}"`);
    this.name = 'ForbiddenError';
  }
}

export function requirePermission(ctx: AuthorizationContext, permission: string): void {
  if (!ctx.permissions.has(permission)) {
    throw new ForbiddenError(permission);
  }
}

export function hasPermission(ctx: AuthorizationContext, permission: string): boolean {
  return ctx.permissions.has(permission);
}
