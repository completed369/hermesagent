import { AsyncLocalStorage } from 'node:async_hooks';
import { prisma } from './client.js';
import type { Prisma } from '@prisma/client';

type CapabilityPolicyClient = Pick<
  Prisma.TransactionClient,
  'subscription' | 'marketplaceAccount' | 'ventureProposal' | 'securityEvent'
>;

export const PROTECTED_CAPABILITIES = [
  'AI_MODEL_EXECUTION',
  'RESEARCH_RUN',
  'PRODUCT_GENERATION',
  'MARKETPLACE_CONNECTION',
  'MARKETPLACE_DRAFT',
  'MARKETPLACE_PUBLICATION',
  'STORAGE_UPLOAD',
  'VENTURE_CREATE',
  'FINANCE_ACCESS',
  'WHITE_LABEL_BRANDING',
  'LICENSE_EXPORT',
  'LIVE_PUBLISHING',
  'ADVERTISING',
  'PAID_INTEGRATION',
  'EXTERNAL_NOTIFICATION',
] as const;

export type ProtectedCapability = (typeof PROTECTED_CAPABILITIES)[number];
export type PolicyEnforcementStage = 'ADMISSION' | 'DISPATCH';

const auditedCapabilityDispatches = new AsyncLocalStorage<ReadonlySet<string>>();

function auditedDispatchKey(params: {
  workspaceId: string;
  capability: ProtectedCapability;
  providerMode?: string;
}): string {
  return `${params.workspaceId}\u0000${params.capability}\u0000${params.providerMode ?? ''}`;
}

export function hasAuditedCapabilityDispatch(params: {
  workspaceId: string;
  capability: ProtectedCapability;
  providerMode?: string;
}): boolean {
  return auditedCapabilityDispatches.getStore()?.has(auditedDispatchKey(params)) ?? false;
}

export const POLICY_REASON_CODES = [
  'SUBSCRIPTION_MISSING',
  'SUBSCRIPTION_STATUS_DENIED',
  'TRIAL_EXPIRY_MISSING',
  'TRIAL_EXPIRED',
  'PLAN_MISSING',
  'PLAN_INACTIVE',
  'ENTITLEMENT_MISSING',
  'USAGE_LIMIT_EXHAUSTED',
  'GLOBAL_SWITCH_DISABLED',
  'GLOBAL_SWITCH_INVALID',
  'PROVIDER_MODE_MISSING',
  'PROVIDER_MODE_UNKNOWN',
  'PROVIDER_MODE_DISABLED',
  'PROVIDER_MODE_UNAVAILABLE',
  'POLICY_STATE_UNAVAILABLE',
] as const;

export type PolicyReasonCode = (typeof POLICY_REASON_CODES)[number];
export const CAPABILITY_POLICY_VERSION = 'phase14-v1';

export interface CapabilityPolicyDecision {
  allowed: boolean;
  capability: ProtectedCapability;
  workspaceId: string;
  reasonCode: PolicyReasonCode | null;
  subscriptionStatus: string | null;
  planKey: string | null;
  entitlement: string;
  providerMode: string | null;
  stage: PolicyEnforcementStage;
  enforcedAt: string;
}

interface CapabilityDefinition {
  entitlement: string;
  providerModeEnv?: string;
  supportedProviderModes: readonly string[];
  liveProviderModes?: readonly string[];
  globalSwitchEnv?: string;
  usageLimit?: 'MARKETPLACE_ACCOUNTS' | 'VENTURES';
}

const CAPABILITY_DEFINITIONS: Record<ProtectedCapability, CapabilityDefinition> = {
  AI_MODEL_EXECUTION: {
    entitlement: 'board',
    providerModeEnv: 'AI_PROVIDER',
    supportedProviderModes: ['mock'],
    liveProviderModes: ['anthropic'],
    globalSwitchEnv: 'FEATURE_PAID_INTEGRATIONS_ENABLED',
  },
  RESEARCH_RUN: { entitlement: 'opportunities', supportedProviderModes: ['mock'] },
  PRODUCT_GENERATION: { entitlement: 'products', supportedProviderModes: ['mock'] },
  MARKETPLACE_CONNECTION: {
    entitlement: 'products',
    providerModeEnv: 'MARKETPLACE_ETSY_MODE',
    supportedProviderModes: ['mock'],
    liveProviderModes: ['live'],
    globalSwitchEnv: 'FEATURE_PAID_INTEGRATIONS_ENABLED',
    usageLimit: 'MARKETPLACE_ACCOUNTS',
  },
  MARKETPLACE_DRAFT: {
    entitlement: 'products',
    providerModeEnv: 'MARKETPLACE_ETSY_MODE',
    supportedProviderModes: ['mock'],
    liveProviderModes: ['live'],
    globalSwitchEnv: 'FEATURE_PAID_INTEGRATIONS_ENABLED',
  },
  MARKETPLACE_PUBLICATION: {
    entitlement: 'products',
    providerModeEnv: 'MARKETPLACE_ETSY_MODE',
    supportedProviderModes: ['mock'],
    liveProviderModes: ['live'],
    globalSwitchEnv: 'FEATURE_LIVE_PUBLISHING_ENABLED',
  },
  STORAGE_UPLOAD: {
    entitlement: 'products',
    providerModeEnv: 'STORAGE_PROVIDER',
    supportedProviderModes: ['mock', 'minio'],
    liveProviderModes: ['minio', 's3'],
    globalSwitchEnv: 'FEATURE_STORAGE_UPLOADS_ENABLED',
  },
  VENTURE_CREATE: {
    entitlement: 'opportunities',
    supportedProviderModes: ['internal'],
    usageLimit: 'VENTURES',
  },
  FINANCE_ACCESS: { entitlement: 'finance', supportedProviderModes: ['internal'] },
  WHITE_LABEL_BRANDING: {
    entitlement: 'white_label',
    supportedProviderModes: ['internal'],
  },
  LICENSE_EXPORT: { entitlement: 'license_export', supportedProviderModes: ['internal'] },
  LIVE_PUBLISHING: {
    entitlement: 'products',
    providerModeEnv: 'MARKETPLACE_ETSY_MODE',
    supportedProviderModes: [],
    liveProviderModes: ['live'],
    globalSwitchEnv: 'FEATURE_LIVE_PUBLISHING_ENABLED',
  },
  ADVERTISING: {
    entitlement: 'advertising',
    providerModeEnv: 'ADVERTISING_PROVIDER_MODE',
    supportedProviderModes: [],
    liveProviderModes: ['live'],
    globalSwitchEnv: 'FEATURE_ADVERTISING_ENABLED',
  },
  PAID_INTEGRATION: {
    entitlement: 'paid_integrations',
    providerModeEnv: 'PAID_INTEGRATION_PROVIDER_MODE',
    supportedProviderModes: [],
    liveProviderModes: ['live'],
    globalSwitchEnv: 'FEATURE_PAID_INTEGRATIONS_ENABLED',
  },
  EXTERNAL_NOTIFICATION: {
    entitlement: 'external_notifications',
    providerModeEnv: 'NOTIFICATION_PROVIDER_MODE',
    supportedProviderModes: [],
    liveProviderModes: ['live'],
    globalSwitchEnv: 'FEATURE_PAID_INTEGRATIONS_ENABLED',
  },
};

export class CapabilityPolicyDeniedError extends Error {
  constructor(readonly decision: CapabilityPolicyDecision) {
    super('Operation is not available');
    this.name = 'CapabilityPolicyDeniedError';
  }
}

/** Deterministic business-state block raised by a final-state hook. */
export class CapabilityFinalCheckBlockedError extends Error {
  constructor(message = 'Operation is not available') {
    super(message);
    this.name = 'CapabilityFinalCheckBlockedError';
  }
}

export function isCapabilityFinalCheckBlockedError(
  error: unknown,
): error is CapabilityFinalCheckBlockedError {
  return (
    error instanceof CapabilityFinalCheckBlockedError ||
    (error instanceof Error && error.name === 'CapabilityFinalCheckBlockedError')
  );
}

export function isCapabilityPolicyDeniedError(
  error: unknown,
): error is CapabilityPolicyDeniedError {
  return (
    error instanceof CapabilityPolicyDeniedError ||
    (error instanceof Error && error.name === 'CapabilityPolicyDeniedError')
  );
}

export interface EnforceCapabilityParams {
  workspaceId: string;
  capability: ProtectedCapability;
  stage: PolicyEnforcementStage;
  providerMode?: string;
  now?: Date;
  /** Intermediate and admission allows are intentionally silent. */
  recordAllow?: boolean;
  correlationReference?: string;
}

export interface CapabilityPolicySnapshot {
  subscription: {
    status: string;
    trialEndsAt: Date | null;
    plan: {
      key: string;
      isActive: boolean;
      features: string[];
      maxMarketplaceAccounts: number;
      maxVentures: number;
    } | null;
  } | null;
  providerMode: string | null;
  configuredProviderMode?: string | null;
  marketplaceAccountCount: number;
  ventureCount: number;
  globalSwitchValue?: string;
}

function deniedDecision(
  params: EnforceCapabilityParams,
  definition: CapabilityDefinition,
  reasonCode: PolicyReasonCode,
  state: {
    subscriptionStatus?: string | null;
    planKey?: string | null;
    providerMode?: string | null;
  } = {},
): CapabilityPolicyDecision {
  return {
    allowed: false,
    capability: params.capability,
    workspaceId: params.workspaceId,
    reasonCode,
    subscriptionStatus: state.subscriptionStatus ?? null,
    planKey: state.planKey ?? null,
    entitlement: definition.entitlement,
    providerMode: state.providerMode ?? null,
    stage: params.stage,
    enforcedAt: (params.now ?? new Date()).toISOString(),
  };
}

function parseStrictBoolean(value: string | undefined): boolean | null {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

async function recordPolicyDecision(
  decision: CapabilityPolicyDecision,
  client: CapabilityPolicyClient,
  correlationReference?: string,
): Promise<void> {
  await client.securityEvent.create({
    data: {
      workspaceId: decision.workspaceId,
      type: decision.allowed ? 'CAPABILITY_POLICY_ALLOWED' : 'CAPABILITY_POLICY_REJECTED',
      severity: decision.allowed ? 'INFO' : 'WARN',
      description: decision.allowed
        ? 'A protected operation was allowed by workspace capability policy.'
        : 'A protected operation was denied by workspace capability policy.',
      metadata: {
        capability: decision.capability,
        decision: decision.allowed ? 'ALLOW' : 'DENY',
        reasonCode: decision.reasonCode ?? 'ALLOWED',
        stage: decision.stage,
        enforcedAt: decision.enforcedAt,
        policyVersion: CAPABILITY_POLICY_VERSION,
        policySource: 'workspace-subscription-and-process-config',
        correlationReference:
          correlationReference ?? `policy:${decision.capability}:${decision.stage}`,
      },
    },
  });
}

export function decideCapabilityPolicy(
  params: EnforceCapabilityParams,
  snapshot: CapabilityPolicySnapshot,
): CapabilityPolicyDecision {
  const definition = CAPABILITY_DEFINITIONS[params.capability];
  const now = params.now ?? new Date();
  const providerMode = params.providerMode ?? snapshot.providerMode;
  const configuredProviderMode = snapshot.configuredProviderMode ?? null;
  const subscription = snapshot.subscription;

  if (!subscription) {
    return deniedDecision(params, definition, 'SUBSCRIPTION_MISSING', { providerMode });
  }

  if (!subscription.plan) {
    return deniedDecision(params, definition, 'PLAN_MISSING', {
      subscriptionStatus: subscription.status,
      providerMode,
    });
  }

  const state = {
    subscriptionStatus: subscription.status,
    planKey: subscription.plan.key,
    providerMode,
  };

  if (subscription.status === 'TRIALING') {
    if (!subscription.trialEndsAt) {
      return deniedDecision(params, definition, 'TRIAL_EXPIRY_MISSING', state);
    }
    if (subscription.trialEndsAt.getTime() <= now.getTime()) {
      return deniedDecision(params, definition, 'TRIAL_EXPIRED', state);
    }
  } else if (subscription.status !== 'ACTIVE') {
    return deniedDecision(params, definition, 'SUBSCRIPTION_STATUS_DENIED', state);
  }

  if (!subscription.plan.isActive) {
    return deniedDecision(params, definition, 'PLAN_INACTIVE', state);
  }

  if (!subscription.plan.features.includes(definition.entitlement)) {
    return deniedDecision(params, definition, 'ENTITLEMENT_MISSING', state);
  }

  if (definition.providerModeEnv) {
    if (!configuredProviderMode) {
      return deniedDecision(params, definition, 'PROVIDER_MODE_MISSING', state);
    }
    const configuredModes = [
      ...definition.supportedProviderModes,
      ...(definition.liveProviderModes ?? []),
    ];
    if (!configuredModes.includes(configuredProviderMode)) {
      return deniedDecision(params, definition, 'PROVIDER_MODE_UNKNOWN', state);
    }
    if (providerMode !== configuredProviderMode) {
      return deniedDecision(params, definition, 'PROVIDER_MODE_DISABLED', state);
    }
  }

  if (!providerMode) {
    return deniedDecision(params, definition, 'PROVIDER_MODE_MISSING', state);
  }

  const liveProviderModes = definition.liveProviderModes ?? [];
  const knownProviderModes = [...definition.supportedProviderModes, ...liveProviderModes];
  if (!knownProviderModes.includes(providerMode)) {
    return deniedDecision(params, definition, 'PROVIDER_MODE_UNKNOWN', state);
  }

  if (liveProviderModes.includes(providerMode)) {
    if (!definition.globalSwitchEnv) {
      return deniedDecision(params, definition, 'GLOBAL_SWITCH_INVALID', state);
    }
    const switchValue = parseStrictBoolean(snapshot.globalSwitchValue);
    if (switchValue === null) {
      return deniedDecision(params, definition, 'GLOBAL_SWITCH_INVALID', state);
    }
    if (!switchValue) {
      return deniedDecision(params, definition, 'GLOBAL_SWITCH_DISABLED', state);
    }
  }

  if (!definition.supportedProviderModes.includes(providerMode)) {
    return deniedDecision(params, definition, 'PROVIDER_MODE_UNAVAILABLE', state);
  }

  if (definition.usageLimit === 'MARKETPLACE_ACCOUNTS') {
    if (snapshot.marketplaceAccountCount >= subscription.plan.maxMarketplaceAccounts) {
      return deniedDecision(params, definition, 'USAGE_LIMIT_EXHAUSTED', state);
    }
  }

  if (
    definition.usageLimit === 'VENTURES' &&
    snapshot.ventureCount >= subscription.plan.maxVentures
  ) {
    return deniedDecision(params, definition, 'USAGE_LIMIT_EXHAUSTED', state);
  }

  return {
    allowed: true,
    capability: params.capability,
    workspaceId: params.workspaceId,
    reasonCode: null,
    subscriptionStatus: subscription.status,
    planKey: subscription.plan.key,
    entitlement: definition.entitlement,
    providerMode,
    stage: params.stage,
    enforcedAt: now.toISOString(),
  };
}

export async function evaluateWorkspaceCapability(
  params: EnforceCapabilityParams,
  client: CapabilityPolicyClient = prisma,
): Promise<CapabilityPolicyDecision> {
  const definition = CAPABILITY_DEFINITIONS[params.capability];
  const configuredProviderMode = definition.providerModeEnv
    ? (process.env[definition.providerModeEnv] ?? null)
    : null;
  const providerMode = params.providerMode ?? configuredProviderMode ?? 'mock';
  const subscription = await client.subscription.findUnique({
    where: { workspaceId: params.workspaceId },
    include: { plan: true },
  });
  const marketplaceAccountCount =
    definition.usageLimit === 'MARKETPLACE_ACCOUNTS'
      ? await client.marketplaceAccount.count({ where: { workspaceId: params.workspaceId } })
      : 0;
  const ventureCount =
    definition.usageLimit === 'VENTURES'
      ? await client.ventureProposal.count({ where: { workspaceId: params.workspaceId } })
      : 0;

  return decideCapabilityPolicy(params, {
    subscription: subscription
      ? {
          status: subscription.status,
          trialEndsAt: subscription.trialEndsAt,
          plan: {
            key: subscription.plan.key,
            isActive: subscription.plan.isActive,
            features: subscription.plan.features,
            maxMarketplaceAccounts: subscription.plan.maxMarketplaceAccounts,
            maxVentures: subscription.plan.maxVentures,
          },
        }
      : null,
    providerMode,
    configuredProviderMode,
    marketplaceAccountCount,
    ventureCount,
    globalSwitchValue: definition.globalSwitchEnv
      ? process.env[definition.globalSwitchEnv]
      : undefined,
  });
}

export async function enforceWorkspaceCapability(
  params: EnforceCapabilityParams,
  client: CapabilityPolicyClient = prisma,
  denialAuditClient: CapabilityPolicyClient = client,
): Promise<CapabilityPolicyDecision> {
  let decision: CapabilityPolicyDecision;
  try {
    decision = await evaluateWorkspaceCapability(params, client);
  } catch {
    decision = deniedDecision(
      params,
      CAPABILITY_DEFINITIONS[params.capability],
      'POLICY_STATE_UNAVAILABLE',
    );
  }

  if (!decision.allowed) {
    try {
      await recordPolicyDecision(decision, denialAuditClient, params.correlationReference);
    } catch {
      // Audit-state failure must never turn a denial into an allow decision.
    }
    throw new CapabilityPolicyDeniedError(decision);
  }

  if (params.recordAllow) {
    try {
      await recordPolicyDecision(decision, client, params.correlationReference);
    } catch {
      throw new CapabilityPolicyDeniedError(
        deniedDecision(
          params,
          CAPABILITY_DEFINITIONS[params.capability],
          'POLICY_STATE_UNAVAILABLE',
        ),
      );
    }
  }

  return decision;
}

export interface DispatchWithCapabilityParams extends EnforceCapabilityParams {
  beforeFinalCheck?: () => Promise<void> | void;
  beforeDispatch?: () => Promise<void> | void;
}

export async function dispatchWithWorkspaceCapability<T>(
  params: DispatchWithCapabilityParams,
  dispatch: () => Promise<T> | T,
  client: CapabilityPolicyClient = prisma,
  denialAuditClient: CapabilityPolicyClient = client,
): Promise<T> {
  const runLocalCheck = async (check?: () => Promise<void> | void) => {
    try {
      await check?.();
    } catch (error) {
      if (isCapabilityPolicyDeniedError(error)) throw error;
      if (isCapabilityFinalCheckBlockedError(error)) throw error;

      const decision = deniedDecision(
        { ...params, stage: 'DISPATCH' },
        CAPABILITY_DEFINITIONS[params.capability],
        'POLICY_STATE_UNAVAILABLE',
      );
      try {
        await recordPolicyDecision(decision, denialAuditClient, params.correlationReference);
      } catch {
        // Local-state denial remains denied even if its audit event cannot be written.
      }
      throw new CapabilityPolicyDeniedError(decision);
    }
  };

  await enforceWorkspaceCapability({ ...params, recordAllow: false }, client, denialAuditClient);
  await runLocalCheck(params.beforeFinalCheck);
  await enforceWorkspaceCapability(
    { ...params, stage: 'DISPATCH', recordAllow: true },
    client,
    denialAuditClient,
  );
  await runLocalCheck(params.beforeDispatch);
  const dispatches = new Set(auditedCapabilityDispatches.getStore());
  dispatches.add(auditedDispatchKey(params));
  return auditedCapabilityDispatches.run(dispatches, dispatch);
}
