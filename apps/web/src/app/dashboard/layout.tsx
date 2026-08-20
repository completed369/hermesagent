import { redirect } from 'next/navigation';
import { serverApiFetch } from '@/lib/server-api';
import { DashboardShell } from '@/components/dashboard-shell';
import type { AuthenticatedUser } from '@/lib/types';
import type { AvailableWorkspace } from '@/components/workspace-switcher';

interface WorkspaceSummary {
  workspace: { name: string };
  branding: { brandName: string | null; logoUrl: string | null; primaryColorHex: string } | null;
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [{ data, status }, { data: workspaceSummary }, { data: memberships }] = await Promise.all([
    serverApiFetch<{ user: AuthenticatedUser }>('/auth/me'),
    serverApiFetch<WorkspaceSummary>('/workspaces/current'),
    serverApiFetch<AvailableWorkspace[]>('/workspaces/available'),
  ]);

  if (status === 401 || !data) {
    redirect('/login');
  }

  // Phase 8 white-label: brand name/logo/accent color come from the
  // workspace's WorkspaceBranding row (set via Settings), falling back to
  // the "VentureOS" defaults for a workspace that hasn't customized them.
  const brandName = workspaceSummary?.branding?.brandName || 'VentureOS';
  const logoUrl = workspaceSummary?.branding?.logoUrl ?? null;
  const accentColor = workspaceSummary?.branding?.primaryColorHex || '#5b8def';

  return (
    <DashboardShell
      brandName={brandName}
      workspaceName={workspaceSummary?.workspace.name || brandName}
      logoUrl={logoUrl}
      email={data.user.email}
      accentColor={accentColor}
      activeWorkspaceId={data.user.workspaceId}
      memberships={memberships ?? []}
      permissions={data.user.permissions}
    >
      {children}
    </DashboardShell>
  );
}
