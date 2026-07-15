import { describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import { SessionAuthGuard } from '../../../common/guards/session-auth.guard';
import { PermissionGuard } from '../../../common/guards/permission.guard';
import { PERMISSION_KEY } from '../../../common/decorators/require-permission.decorator';
import { ProductsController } from '../products.controller';

/**
 * Focused metadata/security test for the Product Studio index controller.
 * This inspects the Nest guard + permission metadata directly via the
 * Reflector (no full HTTP boot, no DB), so it does not depend on the
 * class-token DI path or a live database. Workspace isolation of the
 * underlying query is covered by the integration spec against real Postgres.
 * Behaviour is unchanged from the other product endpoints.
 */
describe('ProductsController (Product Studio index) security metadata', () => {
  const reflector = new Reflector();

  it('applies SessionAuthGuard and PermissionGuard at the controller level', () => {
    const guards = reflector.get('__guards__', ProductsController) as unknown[];
    expect(guards).toBeDefined();
    expect(guards).toContain(SessionAuthGuard);
    expect(guards).toContain(PermissionGuard);
  });

  it('requires product:view on GET /api/products (listForWorkspace)', () => {
    const handler = ProductsController.prototype.listForWorkspace;
    expect(handler).toBeTypeOf('function');
    const required = reflector.get(PERMISSION_KEY, handler);
    expect(required).toBe('product:view');
  });
});
