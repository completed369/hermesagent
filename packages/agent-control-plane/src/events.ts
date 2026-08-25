import { Buffer } from 'node:buffer';

import type { AuthorityLevel, EntityId, WorkspaceContext } from './contracts';

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
  | 'artifact.created'
  | 'approval.requested'
  | 'approval.permit.issued'
  | 'approval.permit.claimed'
  | 'usage.recorded'
  | 'agent.created'
  | 'agent.lifecycle.changed'
  | 'runtime.connection.updated'
  | 'runtime.heartbeat.recorded'
  | 'event.recorded';

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
  append(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    event: OperationalEvent,
  ): void;
  appendBatch(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    events: readonly OperationalEvent[],
  ): void;
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
  'artifact.created',
  'approval.requested',
  'approval.permit.issued',
  'approval.permit.claimed',
  'usage.recorded',
  'agent.created',
  'agent.lifecycle.changed',
  'runtime.connection.updated',
  'runtime.heartbeat.recorded',
  'event.recorded',
]);
const EVENT_SOURCES = new Set<OperationalEvent['source']>([
  'CONTROL_PLANE',
  'AI_COO',
  'AGENT_FACTORY',
]);
const ACTOR_KINDS = new Set<OperationalActorKind>(['HUMAN', 'AGENT', 'RUNTIME', 'SYSTEM']);
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const SAFE_SUBJECT_TYPE = /^[A-Z][A-Za-z0-9]{0,63}$/u;

type FactKind = 'REFERENCE' | 'REFERENCE_LIST' | 'CODE' | 'INTEGER' | 'BOOLEAN';

const FACT_POLICIES: Readonly<Record<OperationalEventType, Readonly<Record<string, FactKind>>>> = {
  'objective.created': { titleLength: 'INTEGER' },
  'project.created': { titleLength: 'INTEGER' },
  'task.created': {
    titleLength: 'INTEGER',
    kind: 'CODE',
    status: 'CODE',
    requiredAuthorityLevel: 'INTEGER',
  },
  'task.ready': { dependencyIds: 'REFERENCE_LIST' },
  'task.blocked': { dependencyIds: 'REFERENCE_LIST' },
  'task.assigned': {
    agentId: 'REFERENCE',
    runtimeId: 'REFERENCE',
    attempt: 'INTEGER',
  },
  'task.retry.ready': { failureCodeDigest: 'CODE', attempt: 'INTEGER' },
  'task.failed': { failureCodeDigest: 'CODE', attempt: 'INTEGER' },
  'task.stopped': { failureCodeDigest: 'CODE', attempt: 'INTEGER' },
  'task.completed': { artifactIds: 'REFERENCE_LIST' },
  'task.status.changed': { previousStatus: 'CODE', nextStatus: 'CODE' },
  'run.created': { taskId: 'REFERENCE', agentId: 'REFERENCE', status: 'CODE' },
  'run.status.changed': {
    previousStatus: 'CODE',
    nextStatus: 'CODE',
    taskId: 'REFERENCE',
  },
  'run.progress': { payloadFieldCount: 'INTEGER', payloadBytes: 'INTEGER' },
  'run.completed': { previousStatus: 'CODE', nextStatus: 'CODE', taskId: 'REFERENCE' },
  'run.failed': { previousStatus: 'CODE', nextStatus: 'CODE', taskId: 'REFERENCE' },
  'artifact.created': { taskId: 'REFERENCE', runId: 'REFERENCE', kind: 'CODE' },
  'approval.requested': {
    dependencyIds: 'REFERENCE_LIST',
    taskId: 'REFERENCE',
    runId: 'REFERENCE',
  },
  'approval.permit.issued': { taskId: 'REFERENCE', runId: 'REFERENCE' },
  'approval.permit.claimed': { taskId: 'REFERENCE', runId: 'REFERENCE' },
  'usage.recorded': {
    taskId: 'REFERENCE',
    runId: 'REFERENCE',
    computeUnits: 'INTEGER',
    costMinorUnits: 'INTEGER',
    currency: 'CODE',
    taskCostUsedMinorUnits: 'INTEGER',
    taskComputeUsed: 'INTEGER',
  },
  'agent.created': { lifecycle: 'CODE' },
  'agent.lifecycle.changed': { lifecycle: 'CODE', reasonPresent: 'BOOLEAN' },
  'runtime.connection.updated': { status: 'CODE', runtimeId: 'REFERENCE' },
  'runtime.heartbeat.recorded': {
    connectionId: 'REFERENCE',
    sequence: 'INTEGER',
    health: 'CODE',
  },
  'event.recorded': { payloadFieldCount: 'INTEGER', payloadBytes: 'INTEGER' },
};

const PRIVATE_FACT_KEYS =
  /(?:chain.?of.?thought|private.?reasoning|prompt|transcript|password|secret|token|credential|api.?key)/iu;
const PRIVATE_FACT_VALUE =
  /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\b(?:sk|gh[opusr]|github_pat)_[A-Za-z0-9_-]{12,})/u;
const PRIVATE_FACT_TEXT =
  /(?:chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|transcript|prompt)/iu;

function boundedText(value: unknown, field: string, maximum = 2_048): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
    throw new OperationalEventPolicyError(`${field} must be non-empty and bounded`);
  }
}

function safeReference(value: unknown, field: string): asserts value is string {
  boundedText(value, field, 256);
  if (
    !SAFE_REFERENCE.test(value) ||
    PRIVATE_FACT_VALUE.test(value) ||
    PRIVATE_FACT_TEXT.test(value)
  ) {
    throw new OperationalEventPolicyError(`${field} must be a safe non-sensitive reference`);
  }
}

function subjectTypeCode(value: unknown): asserts value is string {
  boundedText(value, 'event.subjectType', 64);
  if (
    !SAFE_SUBJECT_TYPE.test(value) ||
    PRIVATE_FACT_VALUE.test(value) ||
    PRIVATE_FACT_TEXT.test(value)
  ) {
    throw new OperationalEventPolicyError(
      'event.subjectType must be a safe non-sensitive subject code',
    );
  }
}

function validateFacts(
  type: OperationalEventType,
  facts: Readonly<Record<string, ObservableFact>>,
): void {
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) {
    throw new OperationalEventPolicyError('Event facts must be a plain object');
  }
  if (Object.getPrototypeOf(facts) !== Object.prototype) {
    throw new OperationalEventPolicyError('Event facts must not have a custom prototype');
  }
  const entries = Object.entries(facts);
  if (entries.length > 32) throw new OperationalEventPolicyError('Event has too many facts');
  const policy = FACT_POLICIES[type];
  for (const [name, value] of entries) {
    boundedText(name, 'fact name', 128);
    if (PRIVATE_FACT_KEYS.test(name)) {
      throw new OperationalEventPolicyError('Private or secret-bearing event facts are forbidden');
    }
    const kind = policy[name];
    if (!kind) throw new OperationalEventPolicyError('Event fact is not allowed for this type');
    if (typeof value === 'string') {
      if (value.length > 2_048) throw new OperationalEventPolicyError('Event fact is too large');
      if (PRIVATE_FACT_VALUE.test(value) || PRIVATE_FACT_TEXT.test(value)) {
        throw new OperationalEventPolicyError('Secret-like event fact values are forbidden');
      }
      if ((kind === 'REFERENCE' || kind === 'CODE') && !SAFE_REFERENCE.test(value)) {
        throw new OperationalEventPolicyError('Event fact must be a safe reference or code');
      }
      if (kind !== 'REFERENCE' && kind !== 'CODE') {
        throw new OperationalEventPolicyError('Event fact has the wrong value kind');
      }
      continue;
    }
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value) || value < 0 || kind !== 'INTEGER') {
        throw new OperationalEventPolicyError(
          'Numeric event facts must be non-negative safe integers',
        );
      }
      continue;
    }
    if (typeof value === 'boolean') {
      if (kind !== 'BOOLEAN') {
        throw new OperationalEventPolicyError('Event fact has the wrong value kind');
      }
      continue;
    }
    if (kind !== 'REFERENCE_LIST' || !Array.isArray(value) || value.length > 32) {
      throw new OperationalEventPolicyError('Event fact has an unsupported value');
    }
    for (const item of value) {
      if (typeof item !== 'string' || !SAFE_REFERENCE.test(item)) {
        throw new OperationalEventPolicyError('Event fact list must contain safe references');
      }
      if (PRIVATE_FACT_VALUE.test(item) || PRIVATE_FACT_TEXT.test(item)) {
        throw new OperationalEventPolicyError('Secret-like event fact values are forbidden');
      }
    }
  }
  if (Buffer.byteLength(JSON.stringify(facts), 'utf8') > 32 * 1_024) {
    throw new OperationalEventPolicyError('Event facts exceed the UTF-8 size limit');
  }
}

export class OperationalEventCapability {
  readonly #source: OperationalEvent['source'];
  readonly #principalActorKinds: ReadonlyMap<string, OperationalActorKind>;
  readonly #principalAuthorityLevels: ReadonlyMap<string, AuthorityLevel>;

  private constructor(
    source: OperationalEvent['source'],
    bindings: readonly OperationalEventPrincipalBinding[],
  ) {
    this.#source = source;
    this.#principalActorKinds = new Map(
      bindings.map((binding) => [
        JSON.stringify([binding.workspaceId, binding.principalId]),
        binding.actorKind,
      ]),
    );
    this.#principalAuthorityLevels = new Map(
      bindings.flatMap((binding) =>
        binding.authorityLevel === undefined
          ? []
          : [[JSON.stringify([binding.workspaceId, binding.principalId]), binding.authorityLevel]],
      ),
    );
  }

  /**
   * Trusted composition-root boundary. Callers must derive bindings from an
   * authenticated server-side principal; request/runtime payloads must never
   * be allowed to issue their own capability.
   */
  static issue(
    source: OperationalEvent['source'],
    bindings: readonly OperationalEventPrincipalBinding[],
  ): OperationalEventCapability {
    if (!EVENT_SOURCES.has(source))
      throw new OperationalEventPolicyError('Unsupported capability source');
    if (!Array.isArray(bindings) || bindings.length === 0 || bindings.length > 64) {
      throw new OperationalEventPolicyError('Capability bindings must be non-empty and bounded');
    }
    const keys = new Set<string>();
    for (const binding of bindings) {
      safeReference(binding.workspaceId, 'capability workspaceId');
      safeReference(binding.principalId, 'capability principalId');
      if (!ACTOR_KINDS.has(binding.actorKind)) {
        throw new OperationalEventPolicyError('Unsupported capability actor kind');
      }
      if (
        binding.authorityLevel !== undefined &&
        (!Number.isInteger(binding.authorityLevel) ||
          binding.authorityLevel < 0 ||
          binding.authorityLevel > 4)
      ) {
        throw new OperationalEventPolicyError('Unsupported capability authority level');
      }
      const bindingKey = JSON.stringify([binding.workspaceId, binding.principalId]);
      if (keys.has(bindingKey)) {
        throw new OperationalEventPolicyError('Duplicate capability principal binding');
      }
      keys.add(bindingKey);
    }
    return new OperationalEventCapability(source, bindings);
  }

  actorKindFor(context: WorkspaceContext): OperationalActorKind {
    const actorKind = this.#principalActorKinds.get(
      JSON.stringify([context.workspaceId, context.principalId]),
    );
    if (!actorKind) {
      throw new OperationalEventPolicyError('No trusted workspace principal binding exists');
    }
    return actorKind;
  }

  assertSource(source: OperationalEvent['source']): void {
    if (source !== this.#source) {
      throw new OperationalEventPolicyError('Event source does not match its trusted capability');
    }
  }

  authorityLevelFor(context: WorkspaceContext): AuthorityLevel {
    this.actorKindFor(context);
    const authorityLevel = this.#principalAuthorityLevels.get(
      JSON.stringify([context.workspaceId, context.principalId]),
    );
    if (authorityLevel === undefined) {
      throw new OperationalEventPolicyError('No trusted principal authority binding exists');
    }
    return authorityLevel;
  }

  assertBinding(context: WorkspaceContext, event: OperationalEvent): void {
    this.assertSource(event.source);
    if (this.actorKindFor(context) !== event.actorKind) {
      throw new OperationalEventPolicyError(
        'Event actor kind does not match its trusted principal binding',
      );
    }
  }
}

export interface OperationalEventPrincipalBinding {
  readonly workspaceId: EntityId;
  readonly principalId: EntityId;
  readonly actorKind: OperationalActorKind;
  readonly authorityLevel?: AuthorityLevel;
}

export function validateOperationalEvent(
  capability: OperationalEventCapability,
  context: WorkspaceContext,
  event: OperationalEvent,
): void {
  if (!(capability instanceof OperationalEventCapability)) {
    throw new OperationalEventPolicyError('A trusted operational event capability is required');
  }
  capability.assertBinding(context, event);
  if (context.workspaceId !== event.workspaceId) {
    throw new OperationalEventPolicyError('Cross-workspace event denied');
  }
  if (context.principalId !== event.actorId) {
    throw new OperationalEventPolicyError('Event actor must match the authenticated principal');
  }
  safeReference(event.id, 'event.id');
  safeReference(event.workspaceId, 'event.workspaceId');
  safeReference(event.actorId, 'event.actorId');
  subjectTypeCode(event.subjectType);
  safeReference(event.subjectId, 'event.subjectId');
  safeReference(event.idempotencyKey, 'event.idempotencyKey');
  if (event.correlationId !== undefined) safeReference(event.correlationId, 'event.correlationId');
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
  validateFacts(event.type, event.facts);
}

export class InMemoryOperationalEventLog implements OperationalEventSink {
  readonly #events = new Map<string, OperationalEvent>();
  readonly #idempotencyKeys = new Set<string>();

  append(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    event: OperationalEvent,
  ): void {
    this.appendBatch(capability, context, [event]);
  }

  appendBatch(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    events: readonly OperationalEvent[],
  ): void {
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
      validateOperationalEvent(capability, context, event);
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
