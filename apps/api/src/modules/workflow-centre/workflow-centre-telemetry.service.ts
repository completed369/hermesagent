import { BadRequestException, Injectable, type MessageEvent } from '@nestjs/common';
import { prisma } from '@ventureos/database';
import { Observable } from 'rxjs';

const POLL_INTERVAL_MS = 2_000;
const KEEPALIVE_INTERVAL_MS = 15_000;
const MAX_STREAM_LIFETIME_MS = 60_000;
const MAX_EVENTS_PER_STREAM = 100;
const INITIAL_REPLAY_LIMIT = 25;
const REPLAY_WINDOW_MS = 10 * 60_000;
const EVENT_BATCH_LIMIT = 25;
const CURSOR =
  /^v1\.(\d{13})\.([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u;
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const SAFE_CODE = /^[A-Z0-9][A-Z0-9._-]{0,127}$/u;
const SENSITIVE_TEXT =
  /(?:chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|authorization|transcript|prompt|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\b(?:sk|gh[opusr]|github_pat|glpat)[_-][A-Za-z0-9_-]{12,}|\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/iu;
const OPERATIONAL_SOURCES = ['CONTROL_PLANE', 'AI_COO', 'AGENT_FACTORY'] as const;

interface Cursor {
  createdAt: Date;
  id: string;
}

interface TelemetryRow {
  id: string;
  source: string;
  action: string;
  entityType: string;
  entityId: string;
  correlationId: string | null;
  occurredAt: Date | null;
  createdAt: Date;
}

function safeReference(value: string): string {
  return SAFE_REFERENCE.test(value) && !SENSITIVE_TEXT.test(value) ? value : 'REDACTED_REFERENCE';
}

function safeCode(value: string): string {
  return SAFE_CODE.test(value) && !SENSITIVE_TEXT.test(value) ? value : 'UNKNOWN';
}

function encodeCursor(row: Pick<TelemetryRow, 'id' | 'createdAt'>): string {
  return `v1.${row.createdAt.getTime()}.${row.id}`;
}

function parseCursor(value: unknown): Cursor | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string') throw new BadRequestException('Invalid telemetry cursor');
  const match = CURSOR.exec(value);
  if (!match) throw new BadRequestException('Invalid telemetry cursor');
  const createdAt = new Date(Number(match[1]));
  if (!Number.isFinite(createdAt.getTime())) {
    throw new BadRequestException('Invalid telemetry cursor');
  }
  return { createdAt, id: match[2]! };
}

function project(row: TelemetryRow): MessageEvent {
  return {
    id: encodeCursor(row),
    type: 'operational.event',
    retry: 5_000,
    data: {
      schemaVersion: 1,
      source: safeCode(row.source),
      type: safeCode(row.action),
      subjectType: safeCode(row.entityType),
      subjectId: safeReference(row.entityId),
      correlationId: row.correlationId ? safeReference(row.correlationId) : null,
      occurredAt: (row.occurredAt ?? row.createdAt).toISOString(),
      recordedAt: row.createdAt.toISOString(),
    },
  };
}

@Injectable()
export class WorkflowCentreTelemetryService {
  stream(workspaceId: string, lastEventId?: unknown): Observable<MessageEvent> {
    const suppliedCursor = parseCursor(lastEventId);

    return new Observable<MessageEvent>((subscriber) => {
      let cursor = suppliedCursor;
      let emittedEvents = 0;
      let polling = false;
      let stopped = false;
      let lastKeepaliveAt = 0;

      const stop = () => {
        if (stopped) return;
        stopped = true;
        clearInterval(interval);
        clearTimeout(lifetime);
        subscriber.complete();
      };

      const poll = async () => {
        if (polling || stopped) return;
        polling = true;
        try {
          const now = new Date();
          const replayFloor = new Date(now.getTime() - REPLAY_WINDOW_MS);
          const effectiveCursor =
            cursor && cursor.createdAt > replayFloor
              ? cursor
              : { createdAt: replayFloor, id: '00000000-0000-0000-0000-000000000000' };
          const remaining = MAX_EVENTS_PER_STREAM - emittedEvents;
          if (remaining <= 0) return stop();

          const isInitialReplay = cursor === undefined;
          const rows = await prisma.auditEvent.findMany({
            where: {
              workspaceId,
              source: { in: [...OPERATIONAL_SOURCES] },
              OR: [
                { createdAt: { gt: effectiveCursor.createdAt } },
                { createdAt: effectiveCursor.createdAt, id: { gt: effectiveCursor.id } },
              ],
            },
            orderBy: isInitialReplay
              ? [{ createdAt: 'desc' }, { id: 'desc' }]
              : [{ createdAt: 'asc' }, { id: 'asc' }],
            take: Math.min(cursor ? EVENT_BATCH_LIMIT : INITIAL_REPLAY_LIMIT, remaining),
            select: {
              id: true,
              source: true,
              action: true,
              entityType: true,
              entityId: true,
              correlationId: true,
              occurredAt: true,
              createdAt: true,
            },
          });

          const chronologicalRows = isInitialReplay ? rows.reverse() : rows;
          for (const row of chronologicalRows) {
            if (stopped) return;
            subscriber.next(project(row));
            cursor = { createdAt: row.createdAt, id: row.id };
            emittedEvents += 1;
          }

          if (emittedEvents >= MAX_EVENTS_PER_STREAM) return stop();
          if (Date.now() - lastKeepaliveAt >= KEEPALIVE_INTERVAL_MS) {
            lastKeepaliveAt = Date.now();
            subscriber.next({
              type: 'transport.keepalive',
              retry: 5_000,
              data: {
                schemaVersion: 1,
                meaning: 'SSE_TRANSPORT_ONLY',
                connectivity: 'NOT_CONFIGURED',
                observedAt: now.toISOString(),
              },
            });
          }
        } catch (error) {
          subscriber.error(error);
          stop();
        } finally {
          polling = false;
        }
      };

      const interval = setInterval(() => void poll(), POLL_INTERVAL_MS);
      const lifetime = setTimeout(stop, MAX_STREAM_LIFETIME_MS);
      void poll();

      return () => {
        stopped = true;
        clearInterval(interval);
        clearTimeout(lifetime);
      };
    });
  }
}
