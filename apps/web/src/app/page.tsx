import Link from 'next/link';
import { BUILD_STATUS } from '@/lib/build-status';
import styles from './page.module.css';

const milestones = BUILD_STATUS.milestones;

const pillars = [
  {
    number: '01',
    title: 'Research with sources',
    text: 'Keep research sources and assumptions beside each business idea.',
  },
  {
    number: '02',
    title: 'Work within your limits',
    text: 'AI helps prepare work. Your permissions and budget determine which actions can proceed.',
  },
  {
    number: '03',
    title: 'One place to track work',
    text: 'Review ideas, product drafts, costs and results in one workspace.',
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
              Sign in
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
              <span className={styles.betaBadge}>Workspace registration</span>
            </div>
            <p className={styles.eyebrow}>Business planning with AI assistance</p>
            <h1 className={styles.title}>
              Build a business with AI.
              <span className={styles.titleAccent}>Stay in control.</span>
            </h1>
            <p className={styles.lede}>
              VentureOS is being built to help you research business ideas, prepare digital products
              and track the work. You set the priorities, review results and control the budget.
            </p>
            <div className={styles.actions}>
              <Link href="/register" className={styles.primaryAction}>
                Create your workspace
              </Link>
              <Link href="/progress" className={styles.secondaryAction}>
                Explore build progress ↗
              </Link>
            </div>
          </div>

          <aside className={styles.heroPanel} aria-label="Current VentureOS build status">
            <div className={styles.heroPanelInner}>
              <p className={styles.panelLabel}>System status</p>
              <h2 className={styles.panelTitle}>Preparing for a public launch</h2>
              <p className={styles.panelText}>{BUILD_STATUS.boundary}</p>
              <div className={styles.signalGrid}>
                <div className={styles.signalCard}>
                  <span className={styles.signalValue}>5</span>
                  <span className={styles.signalLabel}>capability groups implemented</span>
                </div>
                <div className={styles.signalCard}>
                  <span className={styles.signalValue}>3</span>
                  <span className={styles.signalLabel}>runtimes not configured</span>
                </div>
                <div className={styles.signalCard}>
                  <span className={styles.signalValue}>100%</span>
                  <span className={styles.signalLabel}>
                    human authority retained at gated decisions
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
                  Connect the AI agents, test the application and verify product delivery before
                  opening sales.
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
              AI can help with research and product drafts. You decide the goals and limits.
              Connected execution is still being tested before public launch.
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
              <h2 className={styles.sectionTitle}>What is built. What comes next.</h2>
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
              <h3>Preparing the first product</h3>
              <p>
                The first product is a pet-sitting operations tracker. Product checks, checkout and
                delivery must work before it is available to buy.
              </p>
              <ul className={styles.nowList}>
                <li>Modern public landing surface</li>
                <li>Release and staging alignment</li>
                <li>First product and delivery checks</li>
                <li>Public launch follows completed testing</li>
              </ul>
            </aside>
          </div>
        </div>
      </section>

      <div className={styles.shell}>
        <footer className={styles.footer}>
          <span>VentureOS · Development in progress</span>
          <span className={styles.footerLinks}>
            <Link href="/progress">Progress</Link>
            <Link href="/register">Join VentureOS →</Link>
          </span>
        </footer>
      </div>
    </main>
  );
}
