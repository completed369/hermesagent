import Link from 'next/link';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Command Centre', available: true },
  { href: '/dashboard/onboarding', label: 'Onboarding', available: true },
  { href: '/dashboard/audit', label: 'Audit Centre', available: true },
  { href: '/dashboard/security', label: 'Security Events', available: true },
  { href: '/dashboard/settings', label: 'Settings', available: true },
  { href: '#', label: 'Opportunity Feed', available: false },
  { href: '#', label: 'Board Room', available: false },
  { href: '#', label: 'Approval Centre', available: false },
  { href: '#', label: 'Product Studio', available: false },
  { href: '#', label: 'Listing Studio', available: false },
  { href: '#', label: 'Finance Centre', available: false },
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
