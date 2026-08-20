import Link from 'next/link';

interface NavigationItem {
  href: string;
  label: string;
  available: boolean;
  statusLabel?: string;
  requiredPermissions?: string[];
}

export const NAV_ITEMS: NavigationItem[] = [
  { href: '/dashboard', label: 'Command Centre', available: true },
  {
    href: '/dashboard/onboarding',
    label: 'Onboarding',
    available: true,
    requiredPermissions: ['workspace:manage'],
  },
  {
    href: '/dashboard/audit',
    label: 'Audit Centre',
    available: true,
    requiredPermissions: ['audit:view'],
  },
  {
    href: '/dashboard/security',
    label: 'Security Events',
    available: true,
    requiredPermissions: ['audit:view'],
  },
  {
    href: '/dashboard/settings',
    label: 'Settings',
    available: true,
    requiredPermissions: ['workspace:branding:manage', 'workspace:members:manage', 'billing:view'],
  },
  {
    href: '/dashboard/ventures',
    label: 'Ventures',
    available: true,
    requiredPermissions: ['opportunity:view'],
  },
  {
    href: '/dashboard/opportunities',
    label: 'Opportunity Feed',
    available: true,
    requiredPermissions: ['opportunity:view'],
  },
  {
    href: '/dashboard/board-room',
    label: 'Board Room',
    available: true,
    requiredPermissions: ['board:view'],
  },
  {
    href: '/dashboard/approvals',
    label: 'Approval Centre',
    available: true,
    requiredPermissions: ['approval:view'],
  },
  {
    href: '/dashboard/products',
    label: 'Product Studio',
    available: true,
    requiredPermissions: ['product:view'],
  },
  {
    href: '/dashboard/research',
    label: 'Research Connectors',
    available: true,
    requiredPermissions: ['research:view'],
  },
  {
    href: '/dashboard/finance',
    label: 'Finance Centre',
    available: true,
    requiredPermissions: ['finance:view'],
  },
  { href: '#', label: 'Workflow Centre', available: false, statusLabel: 'Planned' },
];

export function DashboardNav({ permissions }: { permissions: string[] }) {
  const visibleItems = NAV_ITEMS.filter(
    (item) =>
      !item.requiredPermissions ||
      item.requiredPermissions.some((permission) => permissions.includes(permission)),
  );
  return (
    <nav className="vos-dashboard-nav">
      {visibleItems.map((item) =>
        item.available ? (
          <Link key={item.label} href={item.href} className="vos-dashboard-navlink">
            {item.label}
          </Link>
        ) : (
          <div
            key={item.label}
            className="vos-dashboard-navlink vos-dashboard-navlink--planned"
            title="Planned capability - not available yet"
          >
            <span>{item.label}</span>
            <span className="vos-badge vos-badge--mock">{item.statusLabel ?? 'Planned'}</span>
          </div>
        ),
      )}
    </nav>
  );
}
