import { redirect } from 'next/navigation';
import { serverApiFetch } from '@/lib/server-api';
import { DashboardNav } from '@/components/dashboard-nav';
import type { AuthenticatedUser } from '@/lib/types';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { data, status } = await serverApiFetch<{ user: AuthenticatedUser }>('/auth/me');

  if (status === 401 || !data) {
    redirect('/login');
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
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
        <div>
          <strong style={{ fontSize: 16 }}>VentureOS</strong>
          <p style={{ fontSize: 12, color: 'var(--vos-text-muted)', margin: '2px 0 0' }}>
            {data.user.email}
          </p>
        </div>
        <DashboardNav />
        <form action="/api/logout-redirect" method="post" style={{ marginTop: 'auto' }}>
          <a href="/login" style={{ fontSize: 13, color: 'var(--vos-text-muted)' }}>
            Sign out
          </a>
        </form>
      </aside>
      <main style={{ flex: 1, padding: 28 }}>{children}</main>
    </div>
  );
}
