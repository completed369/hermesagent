'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { DashboardNav } from '@/components/dashboard-nav';
import { SignOutButton } from '@/components/sign-out-button';

interface DashboardShellProps {
  brandName: string;
  workspaceName: string;
  logoUrl: string | null;
  email: string;
  accentColor: string;
  children: React.ReactNode;
}

export function DashboardShell({
  brandName,
  workspaceName,
  logoUrl,
  email,
  accentColor,
  children,
}: DashboardShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarClosed = isMobile && !open;

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!open || !isMobile) return;
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusableElements = () =>
      Array.from(sidebar.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (element) => element.getClientRects().length > 0,
      );
    const focusFrame = requestAnimationFrame(() => focusableElements()[0]?.focus());
    const containFocus = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeDrawer(true);
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = focusableElements();
      if (elements.length === 0) {
        event.preventDefault();
        return;
      }
      const first = elements[0]!;
      const last = elements[elements.length - 1]!;
      if (!sidebar.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', containFocus);
    return () => {
      cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', containFocus);
    };
  }, [isMobile, open]);

  function closeDrawer(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => menuButtonRef.current?.focus());
  }

  return (
    <div className="vos-dashboard-shell" style={{ ['--vos-accent' as string]: accentColor }}>
      <a className="vos-skip-link" href="#dashboard-content">
        Skip to workspace content
      </a>
      <header className="vos-mobile-header">
        <Link href="/dashboard" className="vos-mobile-brand">
          <span className="vos-dashboard-brandmark">V</span>
          <strong data-testid="mobile-workspace-name">{workspaceName}</strong>
        </Link>
        <button
          ref={menuButtonRef}
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
        tabIndex={-1}
        onClick={() => closeDrawer(true)}
      />
      <aside
        ref={sidebarRef}
        id="workspace-navigation"
        className={`vos-dashboard-sidebar${open ? ' is-open' : ''}`}
        aria-label="Workspace sidebar"
        aria-hidden={sidebarClosed || undefined}
        inert={sidebarClosed || undefined}
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
