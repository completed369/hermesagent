export default function DashboardLoading() {
  return (
    <div className="vos-page-stack" aria-busy="true" aria-label="Loading workspace">
      <div className="vos-loading-heading">
        <span />
        <span />
      </div>
      <div className="vos-stat-grid">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="vos-loading-card" key={index} />
        ))}
      </div>
      <div className="vos-loading-surface" />
    </div>
  );
}
