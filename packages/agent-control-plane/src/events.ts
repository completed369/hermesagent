import { Buffer } from 'node:buffer';

import type { EntityId, WorkspaceContext } from './contracts';

export type OperationalActorKind = 'HUMAN' | 'AGENT' | 'RUNTIME' | 'SYSTEM';

export type OperationalEventType =
  | 'objective.created'
  | 'project.created'
  | 'task.created'
  | 'task.ready'
  | 'task.blocked'
  | 'task.assigned'
  | 'task.retry.ready'
  | 'task.failed'
  | 'task.stopped'
  | 'task.completed'
  | 'task.status.changed'
  | 'run.created'
  | 'run.status.changed'
  | 'run.progress'
  | 'run.completed'
  | 'run.failed'
  | 'approval.requested'
  | 'usage.recorded'
  | 'agent.created'
  | 'agent.lifecycle.changed'
  | 'runtime.connection.updated'
  | 'runtime.heartbeat.recorded';

export type ObservableFact = string | number | boolean | readonly string[];

export interface OperationalEvent {
  readonly id: EntityId;
  readonly workspaceId: EntityId;
  readonly type: OperationalEventType;
  readonly source: 'CONTROL_PLANE' | 'AI_COO' | 'AGENT_FACTORY';
  readonly actorKind: OperationalActorKind;
  readonly actorId: EntityId;
  readonly subjectType: string;
  readonly subjectId: EntityId;
  readonly occurredAt: string;
  readonly idempotencyKey: string;
  readonly correlationId?: EntityId;
  readonly facts: Readonly<Record<string, ObservableFact>>;
}

export interface OperationalEventSink {
  append(context: WorkspaceContext, event: OperationalEvent): void;
  appendBatch(context: WorkspaceContext, events: readonly OperationalEvent[]): void;
}

export class OperationalEventPolicyError extends Error {}
export class DuplicateOperationalEventError extends OperationalEventPolicyError {}

const EVENT_TYPES = new Set<OperationalEventType>([
  'objective.created',
  'project.created',
  'task.created',
  'task.ready',
  'task.blocked',
  'task.assigned',
  'task.retry.ready',
  'task.failed',
  'task.stopped',
  'task.completed',
  'task.status.changed',
  'run.created',
  'run.status.changed',
  'run.progress',
  'run.completed',
  'run.failed',
  'approval.requested',
  'usage.recorded',
  'agent.created',
  'agent.lifecycle.changed',
  'runtime.connection.updated',
  'runtime.heartbeat.recorded',
]);
const EVENT_SOURCES = new Set<OperationalEvent['source']>([
  'CONTROL_PLANE',
  'AI_COO',
  'AGENT_FACTORY',
]);
const ACTOR_KINDS = new Set<OperationalActorKind>(['HUMAN', 'AGENT', 'RUNTIME', 'SYSTEM']);

const PRIVATE_FACT_KEYS =
  /(?:chain.?of.?thought|private.?reasoning|prompt|transcript|password|secret|token|credential|api.?key)/iu;
const PRIVATE_FACT_VALUE =
  /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\b(?:sk|gh[opusr]|github_pat)_[A-Za-z0-9_-]{12,})/u;

function boundedText(value: unknown, field: string, maximum = 2_048): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
    throw new OperationalEventPolicyError(`${field} must be non-empty and bounded`);
  }
}

function validateFacts(facts: Readonly<Record<string, ObservableFact>>): void {
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) {
    throw new OperationalEventPolicyError('Event facts must be a plain object');
  }
  if (Object.getPrototypeOf(facts) !== Object.prototype) {
    throw new OperationalEventPolicyError('Event facts must not have a custom prototype');
  }
  const entries = Object.entries(facts);
  if (entries.length > 32) throw new OperationalEventPolicyError('Event has too many facts');
  for (const [name, value] of entries) {
    boundedText(name, 'fact name', 128);
    if (PRIVATE_FACT_KEYS.test(name)) {
      throw new OperationalEventPolicyError('Private or secret-bearing event facts are forbidden');
    }
    if (typeof value === 'string') {
      if (value.length > 2_048) throw new OperationalEventPolicyError('Event fact is too large');
      if (PRIVATE_FACT_VALUE.test(value)) {
        throw new OperationalEventPolicyError('Secret-like event fact values are forbidden');
      }
      continue;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
        throw new OperationalEventPolicyError('Numeric event facts must be safe integers');
      }
      continue;
    }
    if (typeof value === 'boolean') continue;
    if (!Array.isArray(value) || value.length > 32) {
      throw new OperationalEventPolicyError('Event fact has an unsupported value');
    }
    for (const item of value) {
      if (typeof item !== 'string' || item.length > 2_048) {
        throw new OperationalEventPolicyError('Event fact list must contain bounded strings');
      }
      if (PRIVATE_FACT_VALUE.test(item)) {
        throw new OperationalEventPolicyError('Secret-like event fact values are forbidden');
      }
    }
  }
  if (Buffer.byteLength(JSON.stringify(facts), 'utf8') > 32 * 1_024) {
    throw new OperationalEventPolicyError('Event facts exceed the UTF-8 size limit');
  }
}

export function validateOperationalEvent(context: WorkspaceContext, event: OperationalEvent): void {
  if (context.workspaceId !== event.workspaceId) {
    throw new OperationalEventPolicyError('Cross-workspace event denied');
  }
  if (context.principalId !== event.actorId) {
    throw new OperationalEventPolicyError('Event actor must match the authenticated principal');
  }
  boundedText(event.id, 'event.id');
  boundedText(event.workspaceId, 'event.workspaceId');
  boundedText(event.actorId, 'event.actorId');
  boundedText(event.subjectType, 'event.subjectType', 128);
  boundedText(event.subjectId, 'event.subjectId');
  boundedText(event.idempotencyKey, 'event.idempotencyKey');
  if (event.correlationId !== undefined) boundedText(event.correlationId, 'event.correlationId');
  if (!EVENT_TYPES.has(event.type)) {
    throw new OperationalEventPolicyError('Unsupported operational event type');
  }
  if (!EVENT_SOURCES.has(event.source)) {
    throw new OperationalEventPolicyError('Unsupported operational event source');
  }
  if (!ACTOR_KINDS.has(event.actorKind)) {
    throw new OperationalEventPolicyError('Unsupported operational event actor kind');
  }
  const occurredAt = Date.parse(event.occurredAt);
  if (!Number.isFinite(occurredAt) || new Date(occurredAt).toISOString() !== event.occurredAt) {
    throw new OperationalEventPolicyError('Event occurredAt must be an ISO timestamp');
  }
  validateFacts(event.facts);
}

export class InMemoryOperationalEventLog implements OperationalEventSink {
  readonly #events = new Map<string, OperationalEvent>();
  readonly #idempotencyKeys = new Set<string>();

  append(context: WorkspaceContext, event: OperationalEvent): void {
    this.appendBatch(context, [event]);
  }

  appendBatch(context: WorkspaceContext, events: readonly OperationalEvent[]): void {
    if (events.length === 0 || events.length > 64) {
      throw new OperationalEventPolicyError('Event batch must be non-empty and bounded');
    }
    const additions: Array<{
      eventKey: string;
      idempotencyKey: string;
      event: OperationalEvent;
    }> = [];
    const batchEventKeys = new Set<string>();
    const batchIdempotencyKeys = new Set<string>();
    for (const event of events) {
      validateOperationalEvent(context, event);
      const eventKey = JSON.stringify([event.workspaceId, event.id]);
      const idempotencyKey = JSON.stringify([
        event.workspaceId,
        event.source,
        event.idempotencyKey,
      ]);
      if (this.#events.has(eventKey) || batchEventKeys.has(eventKey)) {
        throw new DuplicateOperationalEventError('Duplicate workspace event ID');
      }
      if (this.#idempotencyKeys.has(idempotencyKey) || batchIdempotencyKeys.has(idempotencyKey)) {
        throw new DuplicateOperationalEventError('Duplicate workspace event idempotency key');
      }
      additions.push({ eventKey, idempotencyKey, event });
      batchEventKeys.add(eventKey);
      batchIdempotencyKeys.add(idempotencyKey);
    }
    for (const addition of additions) {
      this.#events.set(addition.eventKey, structuredClone(addition.event));
      this.#idempotencyKeys.add(addition.idempotencyKey);
    }
  }

  list(context: WorkspaceContext): readonly OperationalEvent[] {
    return [...this.#events.values()]
      .filter((event) => event.workspaceId === context.workspaceId)
      .sort(
        (left, right) =>
          left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id),
      )
      .map((event) => structuredClone(event));
  }
}
