import Link from 'next/link';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Command Centre', available: true },
  { href: '/dashboard/onboarding', label: 'Onboarding', available: true },
  { href: '/dashboard/audit', label: 'Audit Centre', available: true },
  { href: '/dashboard/security', label: 'Security Events', available: true },
  { href: '/dashboard/settings', label: 'Settings', available: true },
  { href: '/dashboard/ventures', label: 'Ventures', available: true },
  { href: '/dashboard/opportunities', label: 'Opportunity Feed', available: true },
  { href: '/dashboard/board-room', label: 'Board Room', available: true },
  { href: '/dashboard/approvals', label: 'Approval Centre', available: true },
  { href: '/dashboard/board-room', label: 'Product Studio', available: true },
  { href: '/dashboard/research', label: 'Research Connectors', available: true },
  { href: '/dashboard/finance', label: 'Finance Centre', available: true },
  { href: '#', label: 'Workflow Centre', available: false },
];

export function DashboardNav() {
  return (
    <nav style={{ display: 'grid', gap: 4, width: 220 }}>
      {NAV_ITEMS.map((item) =>
        item.available ? (
          <Link
            key={item.label}
            href={item.href}
            style={{ padding: '8px 12px', borderRadius: 8, fontSize: 14, textDecoration: 'none' }}
          >
            {item.label}
          </Link>
        ) : (
          <div
            key={item.label}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              fontSize: 14,
              color: 'var(--vos-text-muted)',
              display: 'flex',
              justifyContent: 'space-between',
            }}
            title="Planned for a later phase - not available yet"
          >
            <span>{item.label}</span>
            <span className="vos-badge vos-badge--mock">Phase 2+</span>
          </div>
        ),
      )}
    </nav>
  );
}
