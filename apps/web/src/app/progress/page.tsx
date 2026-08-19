import Link from 'next/link';
import styles from './progress.module.css';

const phases = [
  ['01', 'Foundation', 'Identity, workspaces, governance and audit controls', 'Complete'],
  ['02', 'Intelligence', 'Evidence-backed opportunity research and scoring', 'Complete'],
  ['03', 'Decision system', 'Board review, approvals and human authority', 'Complete'],
  ['04', 'Venture studio', 'Product, listing, finance and experiment workflows', 'Complete'],
  ['05', 'Commercial validation', 'Real evidence, pilot economics and repeatability', 'Active'],
  [
    '06',
    'Production readiness',
    'Operational proof, legal readiness and launch rehearsal',
    'Gated',
  ],
] as const;

export default function ProgressPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}>
          <span>V</span> VentureOS
        </Link>
        <nav>
          <Link href="/">Overview</Link>
          <Link href="/login">Sign in</Link>
          <Link href="/register" className={styles.join}>
            Join VentureOS
          </Link>
        </nav>
      </header>

      <section className={styles.hero}>
        <div className={styles.status}>
          <i /> Public build signal · updated with verified releases
        </div>
        <p className={styles.eyebrow}>VentureOS progress</p>
        <h1>
          Building the control plane
          <br />
          <span>for AI-native ventures.</span>
        </h1>
        <p className={styles.lede}>
          A public, confidentiality-safe view of what is built, what is being validated and what
          remains deliberately gated.
        </p>
        <div className={styles.metrics}>
          <article>
            <strong>4</strong>
            <span>core systems complete</span>
          </article>
          <article>
            <strong>1</strong>
            <span>validation phase active</span>
          </article>
          <article>
            <strong>100%</strong>
            <span>human control at material gates</span>
          </article>
        </div>
      </section>

      <section className={styles.roadmap}>
        <div className={styles.sectionHead}>
          <div>
            <p className={styles.eyebrow}>Release trajectory</p>
            <h2>Progress with proof, not theatre.</h2>
          </div>
          <p>
            Statuses reflect shipped platform capability and verified gates. Confidential
            infrastructure, customer data and commercial diligence remain private.
          </p>
        </div>
        <div className={styles.phaseGrid}>
          {phases.map(([id, name, detail, status]) => (
            <article key={id} className={styles.phase}>
              <div>
                <span className={styles.phaseId}>{id}</span>
                <span
                  className={`${styles.chip} ${status === 'Complete' ? styles.complete : status === 'Active' ? styles.active : styles.gated}`}
                >
                  {status}
                </span>
              </div>
              <h3>{name}</h3>
              <p>{detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.cta}>
        <div>
          <p className={styles.eyebrow}>Open workspace access</p>
          <h2>Build with the system as it evolves.</h2>
          <p>
            Founders, operators, partners and venture teams can create a workspace. Roles and
            approvals keep consequential actions governed.
          </p>
        </div>
        <Link href="/register">
          Create your workspace <span>→</span>
        </Link>
      </section>
      <footer className={styles.footer}>
        <span>VentureOS · Public progress</span>
        <span>No confidential or customer data exposed</span>
      </footer>
    </main>
  );
}
