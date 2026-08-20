'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export const NAV_ITEMS = [
  { href: '/dashboard', label: 'Command Centre', available: true },
  { href: '/dashboard/onboarding', label: 'Onboarding', available: true },
  { href: '/dashboard/audit', label: 'Audit Centre', available: true },
  { href: '/dashboard/security', label: 'Security Events', available: true },
  { href: '/dashboard/settings', label: 'Settings', available: true },
  { href: '/dashboard/ventures', label: 'Ventures', available: true },
  { href: '/dashboard/opportunities', label: 'Opportunity Feed', available: true },
  { href: '/dashboard/board-room', label: 'Board Room', available: true },
  { href: '/dashboard/approvals', label: 'Approval Centre', available: true },
  { href: '/dashboard/products', label: 'Product Studio', available: true },
  { href: '/dashboard/research', label: 'Research Connectors', available: true },
  { href: '/dashboard/finance', label: 'Finance Centre', available: true },
  { href: '#', label: 'Workflow Centre', available: false, statusLabel: 'Planned' },
];

export function DashboardNav() {
  const pathname = usePathname();

  return (
    <nav className="vos-dashboard-nav" aria-label="Workspace navigation">
      {NAV_ITEMS.map((item) =>
        item.available ? (
          <Link
            key={item.label}
            href={item.href}
            className="vos-dashboard-navlink"
            aria-current={isActiveDashboardRoute(pathname, item.href) ? 'page' : undefined}
          >
            <span className="vos-dashboard-nav-indicator" aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        ) : (
          <div
            key={item.label}
            className="vos-dashboard-navlink vos-dashboard-navlink--planned"
            title="Planned capability - not available yet"
          >
            <span>{item.label}</span>
            <span className="vos-badge vos-badge--mock">
              {'statusLabel' in item ? item.statusLabel : 'Planned'}
            </span>
          </div>
        ),
      )}
    </nav>
  );
}

export function isActiveDashboardRoute(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
