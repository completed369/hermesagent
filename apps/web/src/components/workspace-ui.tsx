import type { ReactNode } from 'react';

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="vos-page-header">
      <div>
        <p className="vos-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action ? <div className="vos-page-action">{action}</div> : null}
    </header>
  );
}

export function StatCard({
  label,
  value,
  detail,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  detail?: string;
  tone?: 'default' | 'accent';
}) {
  return (
    <article className={`vos-stat-card vos-stat-card--${tone}`}>
      <p>{label}</p>
      <strong>{value}</strong>
      {detail ? <span>{detail}</span> : null}
    </article>
  );
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="vos-empty-state">
      <span aria-hidden="true">◇</span>
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}

export function DataSurface({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="vos-data-surface">
      {title ? (
        <header>
          <div>
            <h2>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
        </header>
      ) : null}
      <div className="vos-table-scroll">{children}</div>
    </section>
  );
}
