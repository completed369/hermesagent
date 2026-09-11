import { describe, expect, it } from 'vitest';
import { validateDurableObjectivePlan } from '@ventureos/agent-control-plane';
import { buildCeoInstructionPlan } from './ceo-instruction-plan';

const input = {
  workspaceId: '11111111-1111-4111-8111-111111111111',
  eventId: 'Ev123',
  payloadDigest: 'a'.repeat(64),
};
describe('owner instruction research delegation', () => {
  it('produces a valid bounded research task without granting execution', () => {
    const plan = buildCeoInstructionPlan(input);
    expect(() => validateDurableObjectivePlan(plan)).not.toThrow();
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0]).toMatchObject({
      kind: 'business.research',
      requiredAuthority: 1,
      costLimit: { currency: 'EUR', maximumMinorUnits: 2500 },
      retryPolicy: { maximumAttempts: 1 },
      agentPolicy: {
        childLimit: 0,
        toolGrants: [{ toolId: 'research.readonly', scopes: ['read'] }],
      },
    });
    expect(plan.tasks[0]?.approval).toBeUndefined();
  });
  it('recovers the same identity after restart and isolates tenants and events', () => {
    const first = buildCeoInstructionPlan(input);
    expect(buildCeoInstructionPlan(input)).toEqual(first);
    expect(buildCeoInstructionPlan({ ...input, eventId: 'Ev456' }).objective.id).not.toBe(
      first.objective.id,
    );
    expect(
      buildCeoInstructionPlan({ ...input, workspaceId: '22222222-2222-4222-8222-222222222222' })
        .objective.id,
    ).not.toBe(first.objective.id);
    const drift = buildCeoInstructionPlan({ ...input, payloadDigest: 'b'.repeat(64) });
    expect(drift.idempotencyKey).toBe(first.idempotencyKey);
    expect(drift.objective.desiredOutcome).not.toBe(first.objective.desiredOutcome);
  });
  it('rejects malformed provenance and authority below the research minimum', () => {
    expect(() => buildCeoInstructionPlan({ ...input, eventId: '../other' })).toThrow();
    expect(() => buildCeoInstructionPlan({ ...input, payloadDigest: 'invented' })).toThrow();
    const plan = buildCeoInstructionPlan(input);
    expect(() =>
      validateDurableObjectivePlan({
        ...plan,
        tasks: [{ ...plan.tasks[0], requiredAuthority: 0 }],
      }),
    ).toThrow();
  });
});
