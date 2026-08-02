import { describe, expect, it, vi } from 'vitest';
import {
  CapabilityFinalCheckBlockedError,
  CapabilityPolicyDeniedError,
  decideCapabilityPolicy,
  dispatchWithWorkspaceCapability,
  enforceWorkspaceCapability,
  hasAuditedCapabilityDispatch,
  type CapabilityPolicySnapshot,
} from './capability-policy.js';

function entitledTrial(
  overrides: Partial<CapabilityPolicySnapshot> = {},
): CapabilityPolicySnapshot {
  const providerMode = overrides.providerMode ?? 'mock';
  return {
    subscription: {
      status: 'TRIALING',
      trialEndsAt: new Date('2030-01-15T00:00:00.000Z'),
      plan: {
        key: 'TRIAL',
        isActive: true,
        features: ['opportunities', 'board', 'products', 'finance'],
        maxMarketplaceAccounts: 1,
        maxVentures: 1,
      },
    },
    providerMode,
    configuredProviderMode: providerMode,
    marketplaceAccountCount: 0,
    ventureCount: 0,
    globalSwitchValue: 'false',
    ...overrides,
  };
}

describe('capability policy decision contract', () => {
  it('allows an entitled mock research operation during an active trial using a controlled clock', () => {
    const decision = decideCapabilityPolicy(
      {
        workspaceId: 'workspace-a',
        capability: 'RESEARCH_RUN',
        stage: 'DISPATCH',
        now: new Date('2030-01-01T00:00:00.000Z'),
        providerMode: 'mock',
      },
      entitledTrial(),
    );

    expect(decision.allowed).toBe(true);
    expect(decision.reasonCode).toBeNull();
    expect(decision.enforcedAt).toBe('2030-01-01T00:00:00.000Z');
  });

  const baseParams = {
    workspaceId: 'workspace-a',
    capability: 'RESEARCH_RUN' as const,
    stage: 'DISPATCH' as const,
    now: new Date('2030-01-01T00:00:00.000Z'),
    providerMode: 'mock',
  };

  it.each([
    ['missing subscription', { subscription: null }, 'SUBSCRIPTION_MISSING'],
    [
      'trial without an expiry',
      {
        subscription: {
          ...entitledTrial().subscription!,
          trialEndsAt: null,
        },
      },
      'TRIAL_EXPIRY_MISSING',
    ],
    [
      'expired trial',
      {
        subscription: {
          ...entitledTrial().subscription!,
          trialEndsAt: new Date('2029-12-31T23:59:59.999Z'),
        },
      },
      'TRIAL_EXPIRED',
    ],
    [
      'inactive subscription',
      { subscription: { ...entitledTrial().subscription!, status: 'PAST_DUE' } },
      'SUBSCRIPTION_STATUS_DENIED',
    ],
    [
      'cancelled subscription',
      { subscription: { ...entitledTrial().subscription!, status: 'CANCELED' } },
      'SUBSCRIPTION_STATUS_DENIED',
    ],
    [
      'unknown subscription status',
      { subscription: { ...entitledTrial().subscription!, status: 'SUSPENDED_UNKNOWN' } },
      'SUBSCRIPTION_STATUS_DENIED',
    ],
    [
      'missing plan',
      { subscription: { ...entitledTrial().subscription!, plan: null } },
      'PLAN_MISSING',
    ],
    [
      'inactive plan',
      {
        subscription: {
          ...entitledTrial().subscription!,
          plan: { ...entitledTrial().subscription!.plan!, isActive: false },
        },
      },
      'PLAN_INACTIVE',
    ],
    [
      'missing entitlement',
      {
        subscription: {
          ...entitledTrial().subscription!,
          plan: { ...entitledTrial().subscription!.plan!, features: ['products'] },
        },
      },
      'ENTITLEMENT_MISSING',
    ],
  ])('denies %s with a stable reason code', (_label, overrides, expectedReason) => {
    const decision = decideCapabilityPolicy(baseParams, entitledTrial(overrides));
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe(expectedReason);
  });

  it('denies an unknown provider mode', () => {
    const decision = decideCapabilityPolicy(
      { ...baseParams, capability: 'AI_MODEL_EXECUTION', providerMode: 'unexpected' },
      entitledTrial({ providerMode: 'unexpected' }),
    );
    expect(decision.reasonCode).toBe('PROVIDER_MODE_UNKNOWN');
  });

  it('denies a direct adapter whose actual mode conflicts with authoritative config', () => {
    const decision = decideCapabilityPolicy(
      { ...baseParams, capability: 'STORAGE_UPLOAD', providerMode: 'minio' },
      entitledTrial({
        providerMode: 'minio',
        configuredProviderMode: 'mock',
        globalSwitchValue: 'true',
      }),
    );
    expect(decision.reasonCode).toBe('PROVIDER_MODE_DISABLED');
  });

  it('denies provider-backed capability when authoritative provider config is absent', () => {
    const decision = decideCapabilityPolicy(
      { ...baseParams, capability: 'STORAGE_UPLOAD', providerMode: 'minio' },
      entitledTrial({
        providerMode: 'minio',
        configuredProviderMode: null,
        globalSwitchValue: 'true',
      }),
    );
    expect(decision.reasonCode).toBe('PROVIDER_MODE_MISSING');
  });

  it('denies a live provider while its global switch is off', () => {
    const decision = decideCapabilityPolicy(
      { ...baseParams, capability: 'MARKETPLACE_PUBLICATION', providerMode: 'live' },
      entitledTrial({ providerMode: 'live', globalSwitchValue: 'false' }),
    );
    expect(decision.reasonCode).toBe('GLOBAL_SWITCH_DISABLED');
  });

  it('denies malformed global switch state', () => {
    const decision = decideCapabilityPolicy(
      { ...baseParams, capability: 'MARKETPLACE_PUBLICATION', providerMode: 'live' },
      entitledTrial({ providerMode: 'live', globalSwitchValue: 'not-a-boolean' }),
    );
    expect(decision.reasonCode).toBe('GLOBAL_SWITCH_INVALID');
  });

  it('denies an unavailable live adapter even when its switch is on', () => {
    const decision = decideCapabilityPolicy(
      { ...baseParams, capability: 'MARKETPLACE_PUBLICATION', providerMode: 'live' },
      entitledTrial({ providerMode: 'live', globalSwitchValue: 'true' }),
    );
    expect(decision.reasonCode).toBe('PROVIDER_MODE_UNAVAILABLE');
  });

  it('allows safe mock marketplace publication without enabling live publishing', () => {
    const decision = decideCapabilityPolicy(
      { ...baseParams, capability: 'MARKETPLACE_PUBLICATION', providerMode: 'mock' },
      entitledTrial({ providerMode: 'mock', globalSwitchValue: 'false' }),
    );
    expect(decision.allowed).toBe(true);
  });

  it('denies marketplace connection when the plan usage limit is exhausted', () => {
    const decision = decideCapabilityPolicy(
      { ...baseParams, capability: 'MARKETPLACE_CONNECTION', providerMode: 'mock' },
      entitledTrial({ providerMode: 'mock', marketplaceAccountCount: 1 }),
    );
    expect(decision.reasonCode).toBe('USAGE_LIMIT_EXHAUSTED');
  });

  it('denies venture creation when the plan usage limit is exhausted', () => {
    const decision = decideCapabilityPolicy(
      { ...baseParams, capability: 'VENTURE_CREATE', providerMode: 'internal' },
      entitledTrial({ providerMode: 'internal', ventureCount: 1 }),
    );
    expect(decision.reasonCode).toBe('USAGE_LIMIT_EXHAUSTED');
  });

  it.each([
    ['FINANCE_ACCESS', 'finance'],
    ['WHITE_LABEL_BRANDING', 'white_label'],
    ['LICENSE_EXPORT', 'license_export'],
  ] as const)('denies %s when its plan feature is absent', (capability, entitlement) => {
    const snapshot = entitledTrial({ providerMode: 'internal' });
    snapshot.subscription!.plan!.features = snapshot.subscription!.plan!.features.filter(
      (feature) => feature !== entitlement,
    );
    const decision = decideCapabilityPolicy(
      { ...baseParams, capability, providerMode: 'internal' },
      snapshot,
    );
    expect(decision.reasonCode).toBe('ENTITLEMENT_MISSING');
  });
});

function policyClient(options: { entitled?: boolean; eventFailure?: boolean } = {}) {
  const securityEventCreate = options.eventFailure
    ? vi.fn().mockRejectedValue(new Error('synthetic audit failure'))
    : vi.fn().mockResolvedValue({ id: 'event' });
  return {
    subscription: {
      findUnique: vi.fn().mockResolvedValue(
        options.entitled === false
          ? null
          : {
              status: 'ACTIVE',
              trialEndsAt: null,
              plan: {
                key: 'TEST',
                isActive: true,
                features: ['opportunities'],
                maxMarketplaceAccounts: 1,
                maxVentures: 1,
              },
            },
      ),
    },
    marketplaceAccount: { count: vi.fn().mockResolvedValue(0) },
    ventureProposal: { count: vi.fn().mockResolvedValue(0) },
    securityEvent: { create: securityEventCreate },
  };
}

describe('capability policy event contract', () => {
  const params = {
    workspaceId: 'workspace-event-contract',
    capability: 'RESEARCH_RUN' as const,
    stage: 'DISPATCH' as const,
    providerMode: 'mock',
    correlationReference: 'workflow:test',
  };

  it('suppresses intermediate allows and records one correlated final-dispatch allow', async () => {
    const client = policyClient();
    await enforceWorkspaceCapability(params, client as never);
    expect(client.securityEvent.create).not.toHaveBeenCalled();

    await dispatchWithWorkspaceCapability(params, () => Promise.resolve('ok'), client as never);
    expect(client.securityEvent.create).toHaveBeenCalledTimes(1);
    expect(client.securityEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'CAPABILITY_POLICY_ALLOWED',
        metadata: expect.objectContaining({
          stage: 'DISPATCH',
          correlationReference: 'workflow:test',
        }),
      }),
    });
  });

  it('exposes the audited dispatch only within the matching async provider boundary', async () => {
    const client = policyClient();
    expect(hasAuditedCapabilityDispatch(params)).toBe(false);

    await dispatchWithWorkspaceCapability(
      params,
      async () => {
        expect(hasAuditedCapabilityDispatch(params)).toBe(true);
        expect(hasAuditedCapabilityDispatch({ ...params, capability: 'STORAGE_UPLOAD' })).toBe(
          false,
        );
        await Promise.resolve();
        expect(hasAuditedCapabilityDispatch(params)).toBe(true);
      },
      client as never,
    );

    expect(hasAuditedCapabilityDispatch(params)).toBe(false);
  });

  it('runs local-state revalidation after the final policy audit and immediately before dispatch', async () => {
    const client = policyClient();
    const beforeDispatch = vi.fn();
    const dispatch = vi.fn().mockResolvedValue('ok');

    await expect(
      dispatchWithWorkspaceCapability({ ...params, beforeDispatch }, dispatch, client as never),
    ).resolves.toBe('ok');

    expect(client.securityEvent.create).toHaveBeenCalledBefore(beforeDispatch);
    expect(beforeDispatch).toHaveBeenCalledBefore(dispatch);
  });

  it('fails closed when the final allow event cannot be written', async () => {
    const client = policyClient({ eventFailure: true });
    await expect(
      enforceWorkspaceCapability({ ...params, recordAllow: true }, client as never),
    ).rejects.toBeInstanceOf(CapabilityPolicyDeniedError);
  });

  it('records and returns a generic denial when final local-state revalidation fails', async () => {
    const client = policyClient();
    const dispatch = vi.fn();

    await expect(
      dispatchWithWorkspaceCapability(
        {
          ...params,
          beforeDispatch: () => {
            throw new Error('sensitive local-state detail');
          },
        },
        dispatch,
        client as never,
      ),
    ).rejects.toMatchObject({
      message: 'Operation is not available',
      decision: expect.objectContaining({ reasonCode: 'POLICY_STATE_UNAVAILABLE' }),
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(client.securityEvent.create).toHaveBeenCalledTimes(2);
    expect(client.securityEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'CAPABILITY_POLICY_REJECTED',
        metadata: expect.objectContaining({ reasonCode: 'POLICY_STATE_UNAVAILABLE' }),
      }),
    });
  });

  it('preserves an explicit deterministic local block from the final-state hook', async () => {
    const client = policyClient();
    const dispatch = vi.fn();
    const blocked = new CapabilityFinalCheckBlockedError('Local quota exhausted');

    await expect(
      dispatchWithWorkspaceCapability(
        { ...params, beforeDispatch: () => Promise.reject(blocked) },
        dispatch,
        client as never,
      ),
    ).rejects.toBe(blocked);

    expect(dispatch).not.toHaveBeenCalled();
    expect(client.securityEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'CAPABILITY_POLICY_ALLOWED' }),
    });
  });

  it('remains denied when the denial event cannot be written', async () => {
    const client = policyClient({ entitled: false, eventFailure: true });
    await expect(enforceWorkspaceCapability(params, client as never)).rejects.toMatchObject({
      decision: expect.objectContaining({ reasonCode: 'SUBSCRIPTION_MISSING' }),
    });
  });

  it('writes a denial through the durable audit client instead of the aborted business transaction', async () => {
    const transactionClient = policyClient({ entitled: false });
    const durableAuditClient = policyClient({ entitled: false });

    await expect(
      enforceWorkspaceCapability(params, transactionClient as never, durableAuditClient as never),
    ).rejects.toBeInstanceOf(CapabilityPolicyDeniedError);

    expect(transactionClient.securityEvent.create).not.toHaveBeenCalled();
    expect(durableAuditClient.securityEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'CAPABILITY_POLICY_REJECTED' }),
    });
  });
});
