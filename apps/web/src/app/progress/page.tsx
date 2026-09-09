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
          Building one workspace
          <br />
          <span>for your business ideas.</span>
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
            <p className={styles.eyebrow}>Development roadmap</p>
            <h2>What is built and what still needs testing.</h2>
          </div>
          <p>
            These labels describe completed code. They do not mean the service is online,
            the AI agents are connected or a product is available to buy.
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
          <h2>Explore the workspace as it develops.</h2>
          <p>
            Registration works only where this application has been deployed and enabled.
            Creating an account does not start AI agents or spend money.
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
