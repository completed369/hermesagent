'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { DashboardNav } from '@/components/dashboard-nav';
import { SignOutButton } from '@/components/sign-out-button';

interface DashboardShellProps {
  brandName: string;
  logoUrl: string | null;
  email: string;
  accentColor: string;
  children: React.ReactNode;
}

export function DashboardShell({
  brandName,
  logoUrl,
  email,
  accentColor,
  children,
}: DashboardShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);

  return (
    <div className="vos-dashboard-shell" style={{ ['--vos-accent' as string]: accentColor }}>
      <a className="vos-skip-link" href="#dashboard-content">
        Skip to workspace content
      </a>
      <header className="vos-mobile-header">
        <Link href="/dashboard" className="vos-mobile-brand">
          <span className="vos-dashboard-brandmark">V</span>
          <strong>{brandName}</strong>
        </Link>
        <button
          className="vos-menu-button"
          type="button"
          aria-expanded={open}
          aria-controls="workspace-navigation"
          onClick={() => setOpen((current) => !current)}
        >
          <span className="vos-menu-icon" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>{open ? 'Close' : 'Menu'}</span>
        </button>
      </header>
      <button
        className={`vos-sidebar-scrim${open ? ' is-open' : ''}`}
        type="button"
        aria-label="Close navigation"
        tabIndex={open ? 0 : -1}
        onClick={() => setOpen(false)}
      />
      <aside
        id="workspace-navigation"
        className={`vos-dashboard-sidebar${open ? ' is-open' : ''}`}
        aria-label="Workspace sidebar"
      >
        <Link href="/dashboard" className="vos-dashboard-brand">
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" />
          )}
          {!logoUrl ? <span className="vos-dashboard-brandmark">V</span> : null}
          <div>
            <strong>{brandName}</strong>
            <p>{email}</p>
          </div>
        </Link>
        <div className="vos-workspace-pulse">
          <span aria-hidden="true" />
          <div>
            <strong>Workspace online</strong>
            <small>Governance controls active</small>
          </div>
        </div>
        <p className="vos-dashboard-section-label">Navigate</p>
        <DashboardNav />
        <div className="vos-dashboard-signout">
          <SignOutButton />
        </div>
      </aside>
      <main className="vos-dashboard-main" id="dashboard-content" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
