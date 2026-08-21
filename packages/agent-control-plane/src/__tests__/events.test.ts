import { describe, expect, it } from 'vitest';

import {
  DuplicateOperationalEventError,
  InMemoryOperationalEventLog,
  OperationalEventCapability,
  OperationalEventPolicyError,
  type OperationalEvent,
} from '../events';

const context = { workspaceId: 'workspace-a', principalId: 'founder-a' };
const capability = OperationalEventCapability.issue('AI_COO', {
  [context.principalId]: 'HUMAN',
});

function event(overrides: Partial<OperationalEvent> = {}): OperationalEvent {
  return {
    id: 'event-1',
    workspaceId: context.workspaceId,
    type: 'approval.requested',
    source: 'AI_COO',
    actorKind: 'HUMAN',
    actorId: context.principalId,
    subjectType: 'FounderDecisionCard',
    subjectId: 'approval:task-1',
    occurredAt: '2026-08-21T00:00:00.000Z',
    idempotencyKey: 'approval:task-1:requested',
    correlationId: 'objective-1',
    facts: { dependencyIds: ['task-1'] },
    ...overrides,
  };
}

describe('operational event spine', () => {
  it('stores an immutable workspace-scoped copy and orders equal timestamps by ID', () => {
    const log = new InMemoryOperationalEventLog();
    const mutableFacts = { dependencyIds: ['task-2'] };
    log.append(
      capability,
      context,
      event({ id: 'event-2', idempotencyKey: 'key-2', facts: mutableFacts }),
    );
    log.append(capability, context, event({ id: 'event-1', idempotencyKey: 'key-1' }));
    mutableFacts.dependencyIds[0] = 'tampered';

    expect(log.list(context).map((item) => item.id)).toEqual(['event-1', 'event-2']);
    expect(log.list(context)[1]?.facts.dependencyIds).toEqual(['task-2']);
    expect(log.list({ workspaceId: 'workspace-b', principalId: 'founder-b' })).toEqual([]);
  });

  it('rejects cross-workspace and forged-actor events', () => {
    const log = new InMemoryOperationalEventLog();
    expect(() => log.append(capability, context, event({ workspaceId: 'workspace-b' }))).toThrow(
      OperationalEventPolicyError,
    );
    expect(() => log.append(capability, context, event({ actorId: 'runtime-forged' }))).toThrow(
      /trusted principal binding/,
    );
  });

  it('rejects duplicate IDs and source-scoped idempotency replays', () => {
    const log = new InMemoryOperationalEventLog();
    log.append(capability, context, event());
    expect(() => log.append(capability, context, event({ idempotencyKey: 'different' }))).toThrow(
      DuplicateOperationalEventError,
    );
    expect(() => log.append(capability, context, event({ id: 'event-2' }))).toThrow(/idempotency/);
  });

  it('validates a batch atomically before exposing any event', () => {
    const log = new InMemoryOperationalEventLog();
    expect(() =>
      log.appendBatch(capability, context, [
        event({ id: 'batch-1', idempotencyKey: 'batch-key-1' }),
        event({ id: 'batch-2', idempotencyKey: 'batch-key-1' }),
      ]),
    ).toThrow(/idempotency/);
    expect(log.list(context)).toEqual([]);
  });

  it('rejects private-reasoning and secret-bearing fact names', () => {
    const log = new InMemoryOperationalEventLog();
    for (const facts of [
      { prompt: 'do something' },
      { chainOfThought: 'hidden' },
      { apiKey: 'synthetic' },
      { credentialReference: 'vault://reference' },
    ] as ReadonlyArray<Readonly<Record<string, string>>>) {
      expect(() => log.append(capability, context, event({ facts }))).toThrow(
        /Private or secret-bearing/,
      );
    }
  });

  it('rejects secret-like values even when stored under an innocuous fact name', () => {
    const log = new InMemoryOperationalEventLog();
    expect(() =>
      log.append(
        capability,
        context,
        event({ facts: { dependencyIds: ['Bearer synthetic-value-1234567890'] } }),
      ),
    ).toThrow(/safe references|Secret-like/);
    expect(() =>
      log.append(
        capability,
        context,
        event({ facts: { dependencyIds: ['-----BEGIN PRIVATE KEY----- synthetic'] } }),
      ),
    ).toThrow(/safe references|Secret-like/);
  });

  it('rejects custom prototypes, unbounded data, and unsafe numeric facts', () => {
    const log = new InMemoryOperationalEventLog();
    const inherited = Object.create({ hidden: 'value' }) as Record<string, string>;
    inherited.visible = 'value';
    expect(() => log.append(capability, context, event({ facts: inherited }))).toThrow(
      /custom prototype/,
    );
    expect(() =>
      log.append(capability, context, event({ facts: { dependencyIds: ['x'.repeat(2_049)] } })),
    ).toThrow(/safe references/);
    expect(() =>
      log.append(capability, context, event({ facts: { requiredAuthority: Number.MAX_VALUE } })),
    ).toThrow(/safe integers|not allowed/);
  });

  it('rejects unsupported event types at runtime', () => {
    const log = new InMemoryOperationalEventLog();
    expect(() =>
      log.append(
        capability,
        context,
        event({ type: 'deployment.started' as OperationalEvent['type'] }),
      ),
    ).toThrow(/Unsupported operational event type/);
  });

  it('rejects forged event sources and actor kinds at runtime', () => {
    const log = new InMemoryOperationalEventLog();
    expect(() =>
      log.append(capability, context, event({ source: 'FORGED' as OperationalEvent['source'] })),
    ).toThrow(/trusted capability/);
    expect(() =>
      log.append(
        capability,
        context,
        event({ actorKind: 'OWNER' as OperationalEvent['actorKind'] }),
      ),
    ).toThrow(/trusted principal binding/);
  });

  it('rejects ambiguous non-canonical event timestamps', () => {
    const log = new InMemoryOperationalEventLog();
    expect(() => log.append(capability, context, event({ occurredAt: '2026-08-21' }))).toThrow(
      /ISO timestamp/,
    );
  });

  it('rejects free-form and sensitive-looking strings even under allowed event types', () => {
    const log = new InMemoryOperationalEventLog();
    expect(() =>
      log.append(capability, context, event({ facts: { result: 'chain of thought' } })),
    ).toThrow(/not allowed/);
    expect(() =>
      log.append(capability, context, event({ facts: { dependencyIds: ['password=hunter2'] } })),
    ).toThrow(/safe references/);
  });
});
