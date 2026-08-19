import { redirect } from 'next/navigation';
import Link from 'next/link';
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
    <div className="vos-dashboard-shell" style={{ ['--vos-accent' as string]: accentColor }}>
      <aside className="vos-dashboard-sidebar">
        <Link href="/dashboard" className="vos-dashboard-brand">
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={brandName} />
          )}
          {!logoUrl ? <span className="vos-dashboard-brandmark">V</span> : null}
          <div>
            <strong>{brandName}</strong>
            <p>{data.user.email}</p>
          </div>
        </Link>
        <p className="vos-dashboard-section-label">Workspace</p>
        <DashboardNav />
        <div className="vos-dashboard-signout">
          <SignOutButton />
        </div>
      </aside>
      <main className="vos-dashboard-main">{children}</main>
    </div>
  );
}
