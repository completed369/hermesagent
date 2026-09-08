'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserApiUrl } from '@/lib/api';
import styles from './workflows.module.css';

type TelemetryState = 'CONNECTING' | 'ACTIVE' | 'RECONNECTING' | 'UNAVAILABLE';

const LABELS: Readonly<Record<TelemetryState, string>> = {
  CONNECTING: 'connecting',
  ACTIVE: 'active',
  RECONNECTING: 'reconnecting',
  UNAVAILABLE: 'unavailable',
};

const REFRESH_DEBOUNCE_MS = 750;

export function WorkflowTelemetryRefresh() {
  const router = useRouter();
  const [state, setState] = useState<TelemetryState>('CONNECTING');

  useEffect(() => {
    let closed = false;
    let ready = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;

    const scheduleRefresh = () => {
      if (closed || refreshTimer !== undefined) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined;
        if (!closed) router.refresh();
      }, REFRESH_DEBOUNCE_MS);
    };

    let source: EventSource;
    try {
      source = new EventSource(browserApiUrl('/workflow-centre/telemetry'), {
        withCredentials: true,
      });
    } catch {
      setState('UNAVAILABLE');
      return;
    }

    const onKeepalive = () => {
      if (closed) return;
      setState('ACTIVE');
      if (!ready) {
        ready = true;
        // The initial replay may cover work committed after the server-rendered
        // snapshot. Refresh once after it finishes instead of once per replayed row.
        scheduleRefresh();
      }
    };
    const onOperationalEvent = () => {
      if (ready) scheduleRefresh();
    };
    const onError = () => {
      if (!closed) setState('RECONNECTING');
    };

    source.addEventListener('transport.keepalive', onKeepalive);
    source.addEventListener('operational.event', onOperationalEvent);
    source.addEventListener('error', onError);

    return () => {
      closed = true;
      if (refreshTimer !== undefined) clearTimeout(refreshTimer);
      source.removeEventListener('transport.keepalive', onKeepalive);
      source.removeEventListener('operational.event', onOperationalEvent);
      source.removeEventListener('error', onError);
      source.close();
    };
  }, [router]);

  return (
    <p className={styles.telemetryStatus} data-state={state} aria-live="polite">
      <strong>Persisted event notifications:</strong> {LABELS[state]}. Runtime connectivity remains
      NOT_CONFIGURED.
    </p>
  );
}
