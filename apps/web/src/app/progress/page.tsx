import Link from 'next/link';
import { BUILD_STATUS } from '@/lib/build-status';
import styles from './progress.module.css';

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
          <i aria-hidden="true" /> {BUILD_STATUS.label}
        </div>
        <p className={styles.eyebrow}>VentureOS progress</p>
        <h1>
          Building the control plane
          <br />
          <span>for AI-native ventures.</span>
        </h1>
        <p className={styles.lede}>{BUILD_STATUS.boundary}</p>
        <div className={styles.metrics}>
          <article>
            <strong>5</strong>
            <span>capability groups implemented</span>
          </article>
          <article>
            <strong>3</strong>
            <span>runtimes not configured</span>
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
            Statuses describe repository capabilities. They do not prove a live deployment, a
            connected provider or a successful commercial pilot.
          </p>
        </div>
        <div className={styles.phaseGrid}>
          {BUILD_STATUS.milestones.map(({ title, detail, status, tone }, index) => (
            <article key={title} className={styles.phase}>
              <div>
                <span className={styles.phaseId}>{String(index + 1).padStart(2, '0')}</span>
                <span
                  className={`${styles.chip} ${tone === 'complete' ? styles.complete : tone === 'progress' ? styles.active : styles.gated}`}
                >
                  {status}
                </span>
              </div>
              <h3>{title}</h3>
              <p>{detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.cta}>
        <div>
          <p className={styles.eyebrow}>Workspace registration</p>
          <h2>Build with the system as it evolves.</h2>
          <p>
            Registration is available where this application is hosted and enabled. Creating a
            workspace does not activate an AI runtime or authorize external actions.
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
