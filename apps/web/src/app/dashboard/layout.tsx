import { redirect } from 'next/navigation';
import { serverApiFetch } from '@/lib/server-api';
import { DashboardNav } from '@/components/dashboard-nav';
import { SignOutButton } from '@/components/sign-out-button';
import type { AuthenticatedUser } from '@/lib/types';

interface WorkspaceSummary {
  branding: { brandName: string | null; logoUrl: string | null; primaryColorHex: string } | null;
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [{ data, status }, { data: workspaceSummary }] = await Promise.all([
    serverApiFetch<{ user: AuthenticatedUser }>('/auth/me'),
    serverApiFetch<WorkspaceSummary>('/workspaces/current'),
  ]);

  if (status === 401 || !data) {
    redirect('/login');
  }

  // Phase 8 white-label: brand name/logo/accent color come from the
  // workspace's WorkspaceBranding row (set via Settings), falling back to
  // the "VentureOS" defaults for a workspace that hasn't customized them.
  const brandName = workspaceSummary?.branding?.brandName || 'VentureOS';
  const logoUrl = workspaceSummary?.branding?.logoUrl;
  const accentColor = workspaceSummary?.branding?.primaryColorHex || '#5b8def';

  return (
    <div style={{ display: 'flex', minHeight: '100vh', ['--vos-accent' as string]: accentColor }}>
      <aside
        style={{
          width: 240,
          borderRight: '1px solid var(--vos-border)',
          padding: '20px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={brandName} style={{ width: 24, height: 24, borderRadius: 4 }} />
          )}
          <div>
            <strong style={{ fontSize: 16 }}>{brandName}</strong>
            <p style={{ fontSize: 12, color: 'var(--vos-text-muted)', margin: '2px 0 0' }}>
              {data.user.email}
            </p>
          </div>
        </div>
        <DashboardNav />
        <SignOutButton />
      </aside>
      <main style={{ flex: 1, padding: 28 }}>{children}</main>
    </div>
  );
}
