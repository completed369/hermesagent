export default function SettingsPage() {
  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Settings</h1>
      <p style={{ color: 'var(--vos-text-muted)', fontSize: 13, marginTop: 0 }}>
        Branding, currency, and governance thresholds are configurable so this platform can later be
        renamed or white-labelled (master spec section 1).
      </p>
      <div className="vos-card" style={{ marginTop: 16, display: 'grid', gap: 12 }}>
        <Row label="Product name" value="VentureOS (configurable)" />
        <Row label="Base currency" value="EUR" />
        <Row label="Interface language" value="English" />
        <Row label="Board approval threshold" value="75%" />
        <Row label="Evidence quality minimum" value="70%" />
        <Row label="Live publishing" value="Disabled" badge="mock" />
        <Row label="Advertising" value="Disabled" badge="mock" />
      </div>
      <p style={{ fontSize: 12, color: 'var(--vos-text-muted)', marginTop: 12 }}>
        Full settings management UI is planned for a later phase; these values currently come from
        <code> .env</code> defaults.
      </p>
    </div>
  );
}

function Row({ label, value, badge }: { label: string; value: string; badge?: 'mock' | 'ok' }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
      <span style={{ color: 'var(--vos-text-muted)' }}>{label}</span>
      <span>
        {value} {badge ? <span className={`vos-badge vos-badge--${badge}`}>{badge}</span> : null}
      </span>
    </div>
  );
}
