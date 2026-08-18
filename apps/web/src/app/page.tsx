import Link from 'next/link';
import styles from './page.module.css';

const milestones = [
  {
    title: 'Foundation & governance',
    detail: 'Workspace controls, auditability and founder authority',
    status: 'Complete',
    tone: 'complete',
  },
  {
    title: 'Opportunity intelligence',
    detail: 'Evidence-backed intake, scoring and freshness controls',
    status: 'Complete',
    tone: 'complete',
  },
  {
    title: 'Board & founder approvals',
    detail: 'Weighted review, vetoes and persisted approval gates',
    status: 'Complete',
    tone: 'complete',
  },
  {
    title: 'Product & listing studio',
    detail: 'Governed product preparation and marketplace-ready workflows',
    status: 'Complete',
    tone: 'complete',
  },
  {
    title: 'Research & staging foundation',
    detail: 'Evidence connectors, security gates and private validation',
    status: 'Complete',
    tone: 'complete',
  },
  {
    title: 'Genuine commercial validation',
    detail: 'Real pilot evidence, economics and founder-gated decisions',
    status: 'In progress',
    tone: 'progress',
  },
  {
    title: 'Production launch',
    detail: 'Unlocked only after commercial validation is genuinely passed',
    status: 'Gated',
    tone: 'locked',
  },
] as const;

const pillars = [
  {
    number: '01',
    title: 'Evidence-first intelligence',
    text: 'Research and opportunity scoring are tied to provenance, freshness and explicit confidence instead of free-form optimism.',
  },
  {
    number: '02',
    title: 'Approval-gated agents',
    text: 'AI can research, draft, calculate and recommend. Sensitive actions remain behind deterministic policy and founder approval.',
  },
  {
    number: '03',
    title: 'Venture control plane',
    text: 'One operating layer for opportunity review, product preparation, finance, experiments and multi-venture governance.',
  },
] as const;

export default function RootPage() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <Link href="/" className={styles.brand} aria-label="VentureOS home">
            <span className={styles.brandMark}>V</span>
            VentureOS
          </Link>
          <nav className={styles.nav} aria-label="Primary navigation">
            <a href="#platform">Platform</a>
            <a href="#progress">Progress</a>
            <Link href="/login" className={styles.loginLink}>
              Founder access
            </Link>
          </nav>
        </header>

        <section className={styles.hero}>
          <div>
            <div className={styles.statusRow}>
              <span className={styles.liveBadge}>
                <span className={styles.pulse} aria-hidden="true" />
                Development in progress
              </span>
              <span className={styles.betaBadge}>Private beta</span>
            </div>
            <p className={styles.eyebrow}>Human-controlled AI venture operations</p>
            <h1 className={styles.title}>
              Build companies with AI.
              <span className={styles.titleAccent}>Keep the authority.</span>
            </h1>
            <p className={styles.lede}>
              VentureOS is a governed operating system for researching, validating, building and
              operating digital ventures with an AI team — while the founder retains final control
              over approvals, risk and spend.
            </p>
            <div className={styles.actions}>
              <a href="#progress" className={styles.primaryAction}>
                View live progress
              </a>
              <Link href="/login" className={styles.secondaryAction}>
                Private founder access
              </Link>
            </div>
          </div>

          <aside className={styles.heroPanel} aria-label="Current VentureOS build status">
            <div className={styles.heroPanelInner}>
              <p className={styles.panelLabel}>System status</p>
              <h2 className={styles.panelTitle}>From prototype to governed venture engine</h2>
              <p className={styles.panelText}>
                Core operating layers are built. The project is now moving through real commercial
                validation before production exposure.
              </p>
              <div className={styles.signalGrid}>
                <div className={styles.signalCard}>
                  <span className={styles.signalValue}>5</span>
                  <span className={styles.signalLabel}>core milestone groups complete</span>
                </div>
                <div className={styles.signalCard}>
                  <span className={styles.signalValue}>1</span>
                  <span className={styles.signalLabel}>commercial validation phase active</span>
                </div>
                <div className={styles.signalCard}>
                  <span className={styles.signalValue}>100%</span>
                  <span className={styles.signalLabel}>
                    founder authority retained at gated decisions
                  </span>
                </div>
                <div className={styles.signalCard}>
                  <span className={styles.signalValue}>0</span>
                  <span className={styles.signalLabel}>production shortcuts allowed</span>
                </div>
              </div>
              <div className={styles.focusCard}>
                <strong>Current focus</strong>
                <span>
                  Public launch surface, release alignment and the first evidence-backed commercial
                  validation cycle.
                </span>
              </div>
            </div>
          </aside>
        </section>
      </div>

      <section id="platform" className={styles.section}>
        <div className={styles.shell}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.eyebrow}>The operating model</p>
              <h2 className={styles.sectionTitle}>AI speed, without giving up control.</h2>
            </div>
            <p className={styles.sectionText}>
              VentureOS is being built around an explicit separation: agents can do the heavy
              analytical and operational work, while policy and persisted approvals govern what can
              actually happen.
            </p>
          </div>

          <div className={styles.pillars}>
            {pillars.map((pillar) => (
              <article className={styles.pillar} key={pillar.number}>
                <span className={styles.pillarNumber}>{pillar.number}</span>
                <h3>{pillar.title}</h3>
                <p>{pillar.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="progress" className={styles.section}>
        <div className={styles.shell}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.eyebrow}>Development tracker</p>
              <h2 className={styles.sectionTitle}>Built in stages. Released behind gates.</h2>
            </div>
            <p className={styles.sectionText}>
              This tracker shows the public development state without exposing credentials,
              infrastructure internals or confidential commercial data.
            </p>
          </div>

          <div className={styles.progressGrid}>
            <div className={styles.timeline}>
              {milestones.map((milestone) => (
                <div className={styles.timelineItem} key={milestone.title}>
                  <span
                    className={`${styles.timelineDot} ${
                      milestone.tone === 'complete'
                        ? styles.timelineDotComplete
                        : milestone.tone === 'progress'
                          ? styles.timelineDotProgress
                          : ''
                    }`}
                    aria-hidden="true"
                  />
                  <div>
                    <p className={styles.timelineTitle}>{milestone.title}</p>
                    <p className={styles.timelineSub}>{milestone.detail}</p>
                  </div>
                  <span
                    className={
                      milestone.tone === 'complete'
                        ? styles.statusComplete
                        : milestone.tone === 'progress'
                          ? styles.statusProgress
                          : styles.statusLocked
                    }
                  >
                    {milestone.status}
                  </span>
                </div>
              ))}
            </div>

            <aside className={styles.nowCard}>
              <p className={styles.panelLabel}>Now building</p>
              <h3>The public face of VentureOS</h3>
              <p>
                The engineering core is staying stable while the project gets a clear public entry
                point and prepares to resume its first genuine commercial-validation cycle.
              </p>
              <ul className={styles.nowList}>
                <li>Modern public landing surface</li>
                <li>Release and staging alignment</li>
                <li>Evidence-backed commercial validation next</li>
                <li>Production remains gated until validation passes</li>
              </ul>
            </aside>
          </div>
        </div>
      </section>

      <div className={styles.shell}>
        <footer className={styles.footer}>
          <span>VentureOS · Development in progress</span>
          <Link href="/login">Founder access →</Link>
        </footer>
      </div>
    </main>
  );
}
