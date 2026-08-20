import { describe, expect, it } from 'vitest';
import { isActiveDashboardRoute, NAV_ITEMS } from '@/components/dashboard-nav';

// NAV_ITEMS is a named export; assert routing without pulling in Next.js
// <Link> (which requires a React DOM env).
describe('Dashboard navigation', () => {
  const nav = NAV_ITEMS as Array<{
    href: string;
    label: string;
    available: boolean;
    statusLabel?: string;
  }>;

  it('has exactly one item pointing to /dashboard/board-room', () => {
    const boardRoom = nav.filter((i) => i.href === '/dashboard/board-room');
    expect(boardRoom).toHaveLength(1);
    expect(boardRoom[0]?.label).toBe('Board Room');
  });

  it('has exactly one item pointing to /dashboard/products (Product Studio)', () => {
    const productStudio = nav.filter((i) => i.href === '/dashboard/products');
    expect(productStudio).toHaveLength(1);
    expect(productStudio[0]?.label).toBe('Product Studio');
  });

  it('has no duplicate destinations among available items', () => {
    const availableHrefs = nav.filter((i) => i.available).map((i) => i.href);
    expect(new Set(availableHrefs).size).toBe(availableHrefs.length);
  });

  it('uses a durable planned label instead of stale phase numbering', () => {
    const workflowCentre = nav.find((i) => i.label === 'Workflow Centre');
    expect(workflowCentre).toMatchObject({ available: false, statusLabel: 'Planned' });
    expect(workflowCentre?.statusLabel).not.toMatch(/phase/i);
  });

  it('marks exact and nested workspace routes active without matching siblings', () => {
    expect(isActiveDashboardRoute('/dashboard', '/dashboard')).toBe(true);
    expect(isActiveDashboardRoute('/dashboard/products', '/dashboard')).toBe(false);
    expect(isActiveDashboardRoute('/dashboard/products/product-1', '/dashboard/products')).toBe(
      true,
    );
    expect(isActiveDashboardRoute('/dashboard/products-old', '/dashboard/products')).toBe(false);
  });
});
