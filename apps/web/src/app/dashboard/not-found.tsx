import Link from 'next/link';

export default function DashboardNotFound() {
  return (
    <div className="vos-route-state">
      <span aria-hidden="true">404</span>
      <p className="vos-eyebrow">Route not found</p>
      <h1>This workspace view does not exist.</h1>
      <p>Return to the Command Centre to continue with a known route.</p>
      <Link className="vos-btn" href="/dashboard">
        Return to Command Centre
      </Link>
    </div>
  );
}
