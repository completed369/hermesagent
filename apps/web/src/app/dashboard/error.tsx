'use client';

export default function DashboardError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="vos-route-state" role="alert">
      <span aria-hidden="true">!</span>
      <p className="vos-eyebrow">Workspace interruption</p>
      <h1>We couldn&apos;t load this view.</h1>
      <p>The underlying action was not changed. Try loading the current view again.</p>
      <button type="button" className="vos-btn" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
