import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  CapabilityPolicyDeniedError,
  dispatchWithWorkspaceCapability,
  prisma,
} from '@ventureos/database';
import { ContractNotFoundError, runDataAcquisition } from '@ventureos/research-connectors';
import { cleanupEntitledTestWorkspace, entitleTestWorkspace } from './helpers/entitled-workspace';
import { enforceCapabilityAdmission } from '../src/common/policy/capability-admission';
import { AuditService } from '../src/modules/audit/audit.service';
import { BillingService } from '../src/modules/billing/billing.service';
import { FinanceService } from '../src/modules/finance/finance.service';
import { WorkspacesService } from '../src/modules/workspaces/workspaces.service';

interface Scenario {
  workspaceId: string;
  contractId: string;
}

describe('subscription and provider policy enforcement (integration)', () => {
  const scenarios: Scenario[] = [];

  async function createScenario(): Promise<Scenario> {
    const workspace = await prisma.workspace.create({
      data: {
        name: `Policy Test Workspace ${randomUUID()}`,
        slug: `policy-test-${randomUUID()}`,
      },
    });
    const contract = await prisma.dataAcquisitionContract.create({
      data: {
        workspaceId: workspace.id,
        name: `Policy Test Research ${randomUUID()}`,
        purpose: 'Synthetic subscription-policy enforcement proof',
        sourceType: 'FOUNDER_PROVIDED',
        accessMethod: 'FOUNDER_PROVIDED',
        allowedOperations: ['READ_FOUNDER_PROVIDED'],
        costPerRunEurEstimate: 0,
      },
    });
    const scenario = { workspaceId: workspace.id, contractId: contract.id };
    scenarios.push(scenario);
    return scenario;
  }

  afterAll(async () => {
    for (const { workspaceId, contractId } of scenarios) {
      await prisma.securityEvent.deleteMany({ where: { workspaceId } });
      await prisma.evidenceClaim.deleteMany({
        where: { evidenceArtifact: { workspaceId } },
      });
      await prisma.evidenceArtifact.deleteMany({ where: { workspaceId } });
      await prisma.dataSource.deleteMany({ where: { dataAcquisitionContractId: contractId } });
      await prisma.dataAcquisitionRun.deleteMany({ where: { contractId } });
      await prisma.integration.deleteMany({ where: { workspaceId } });
      await prisma.marketplaceAccount.deleteMany({ where: { workspaceId } });
      await prisma.dataAcquisitionContract.deleteMany({ where: { id: contractId } });
      await cleanupEntitledTestWorkspace(workspaceId);
      await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    }
    await prisma.$disconnect();
  });

  it('denies a direct research call with no subscription before any provider-shaped work', async () => {
    const scenario = await createScenario();

    await expect(runDataAcquisition(scenario)).rejects.toThrow('Operation is not available');

    expect(
      await prisma.dataAcquisitionRun.count({ where: { contractId: scenario.contractId } }),
    ).toBe(0);
    expect(
      await prisma.evidenceArtifact.count({ where: { workspaceId: scenario.workspaceId } }),
    ).toBe(0);
  });

  it('allows an entitled mock operation during an active trial', async () => {
    const scenario = await createScenario();
    await entitleTestWorkspace(scenario.workspaceId, {
      status: 'TRIALING',
      trialEndsAt: new Date(Date.now() + 60_000),
    });

    const result = await runDataAcquisition(scenario);
    expect(result.status).toBe('SUCCEEDED');
    expect(result.evidenceArtifactId).toBeTruthy();
    const allowedEvent = await prisma.securityEvent.findFirst({
      where: { workspaceId: scenario.workspaceId, type: 'CAPABILITY_POLICY_ALLOWED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(allowedEvent?.metadata).toMatchObject({
      capability: 'RESEARCH_RUN',
      decision: 'ALLOW',
      reasonCode: 'ALLOWED',
      policyVersion: 'phase14-v1',
    });
  });

  it.each([
    ['expired trial', 'TRIALING', new Date(0), 'TRIAL_EXPIRED'],
    ['inactive subscription', 'PAST_DUE', null, 'SUBSCRIPTION_STATUS_DENIED'],
    ['cancelled subscription', 'CANCELED', null, 'SUBSCRIPTION_STATUS_DENIED'],
  ])('denies an %s without a provider call', async (_label, status, trialEndsAt, reasonCode) => {
    const scenario = await createScenario();
    await entitleTestWorkspace(scenario.workspaceId, { status, trialEndsAt });

    await expect(runDataAcquisition(scenario)).rejects.toThrow('Operation is not available');
    expect(
      await prisma.dataAcquisitionRun.count({ where: { contractId: scenario.contractId } }),
    ).toBe(0);
    const event = await prisma.securityEvent.findFirst({
      where: { workspaceId: scenario.workspaceId, type: 'CAPABILITY_POLICY_REJECTED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(event?.metadata).toMatchObject({ reasonCode, capability: 'RESEARCH_RUN' });
  });

  it('records one redacted reason code and exposes only a generic error', async () => {
    const scenario = await createScenario();
    const syntheticSecret = `never-audit-${randomUUID()}`;

    let caught: unknown;
    try {
      await dispatchWithWorkspaceCapability(
        {
          workspaceId: scenario.workspaceId,
          capability: 'AI_MODEL_EXECUTION',
          stage: 'DISPATCH',
          providerMode: syntheticSecret,
        },
        () => Promise.resolve('not-called'),
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CapabilityPolicyDeniedError);
    expect((caught as Error).message).toBe('Operation is not available');
    const events = await prisma.securityEvent.findMany({
      where: { workspaceId: scenario.workspaceId, type: 'CAPABILITY_POLICY_REJECTED' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.metadata).toMatchObject({
      reasonCode: 'SUBSCRIPTION_MISSING',
      capability: 'AI_MODEL_EXECUTION',
      stage: 'DISPATCH',
    });
    expect(JSON.stringify(events[0])).not.toContain(syntheticSecret);
  });

  it('rechecks queued work after subscription revocation and makes zero dispatch calls', async () => {
    const scenario = await createScenario();
    await entitleTestWorkspace(scenario.workspaceId);
    let dispatchCalls = 0;

    await expect(
      dispatchWithWorkspaceCapability(
        {
          workspaceId: scenario.workspaceId,
          capability: 'RESEARCH_RUN',
          stage: 'DISPATCH',
          providerMode: 'mock',
          beforeFinalCheck: async () => {
            await prisma.subscription.update({
              where: { workspaceId: scenario.workspaceId },
              data: { status: 'CANCELED' },
            });
          },
        },
        () => {
          dispatchCalls += 1;
          return Promise.resolve('dispatched');
        },
      ),
    ).rejects.toThrow('Operation is not available');
    expect(dispatchCalls).toBe(0);
  });

  it('rechecks current provider mode and global switch after work was queued', async () => {
    const scenario = await createScenario();
    await entitleTestWorkspace(scenario.workspaceId);
    const previousMode = process.env.MARKETPLACE_ETSY_MODE;
    const previousSwitch = process.env.FEATURE_LIVE_PUBLISHING_ENABLED;
    process.env.MARKETPLACE_ETSY_MODE = 'mock';
    process.env.FEATURE_LIVE_PUBLISHING_ENABLED = 'true';
    let dispatchCalls = 0;

    try {
      await expect(
        dispatchWithWorkspaceCapability(
          {
            workspaceId: scenario.workspaceId,
            capability: 'MARKETPLACE_PUBLICATION',
            stage: 'DISPATCH',
            beforeFinalCheck: () => {
              process.env.MARKETPLACE_ETSY_MODE = 'live';
              process.env.FEATURE_LIVE_PUBLISHING_ENABLED = 'false';
            },
          },
          () => {
            dispatchCalls += 1;
            return Promise.resolve('dispatched');
          },
        ),
      ).rejects.toThrow('Operation is not available');
    } finally {
      if (previousMode === undefined) delete process.env.MARKETPLACE_ETSY_MODE;
      else process.env.MARKETPLACE_ETSY_MODE = previousMode;
      if (previousSwitch === undefined) delete process.env.FEATURE_LIVE_PUBLISHING_ENABLED;
      else process.env.FEATURE_LIVE_PUBLISHING_ENABLED = previousSwitch;
    }
    expect(dispatchCalls).toBe(0);
    const event = await prisma.securityEvent.findFirst({
      where: { workspaceId: scenario.workspaceId, type: 'CAPABILITY_POLICY_REJECTED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(event?.metadata).toMatchObject({ reasonCode: 'GLOBAL_SWITCH_DISABLED' });
  });

  it('does not borrow another workspace subscription or contract', async () => {
    const entitled = await createScenario();
    const other = await createScenario();
    await entitleTestWorkspace(entitled.workspaceId);
    await entitleTestWorkspace(other.workspaceId);

    await expect(
      runDataAcquisition({ workspaceId: other.workspaceId, contractId: entitled.contractId }),
    ).rejects.toBeInstanceOf(ContractNotFoundError);
    expect(await prisma.evidenceArtifact.count({ where: { workspaceId: other.workspaceId } })).toBe(
      0,
    );
  });

  it('records exactly one final-dispatch allow decision with safe correlation metadata', async () => {
    const scenario = await createScenario();
    await entitleTestWorkspace(scenario.workspaceId);
    await enforceCapabilityAdmission(scenario.workspaceId, 'RESEARCH_RUN', 'mock');
    await dispatchWithWorkspaceCapability(
      {
        workspaceId: scenario.workspaceId,
        capability: 'RESEARCH_RUN',
        stage: 'DISPATCH',
        providerMode: 'mock',
      },
      () => Promise.resolve(),
    );
    const events = await prisma.securityEvent.findMany({
      where: { workspaceId: scenario.workspaceId, type: 'CAPABILITY_POLICY_ALLOWED' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.metadata).toMatchObject({
      stage: 'DISPATCH',
      correlationReference: 'policy:RESEARCH_RUN:DISPATCH',
    });
  });

  it('wires finance, white-label, and license-export entitlements into API services', async () => {
    const scenario = await createScenario();
    await entitleTestWorkspace(scenario.workspaceId, {
      features: ['opportunities', 'board', 'products'],
    });
    const auditService = new AuditService();
    const financeService = new FinanceService(auditService);
    const billingService = new BillingService(auditService);
    const workspacesService = new WorkspacesService();

    await expect(financeService.listBudgets(scenario.workspaceId)).rejects.toThrow(
      'Operation is not available',
    );
    await expect(billingService.listLicenseKeys(scenario.workspaceId)).rejects.toThrow(
      'Operation is not available',
    );
    await expect(
      workspacesService.updateBranding(scenario.workspaceId, { brandName: 'Blocked' }),
    ).rejects.toThrow('Operation is not available');
  });

  it('fails closed and never dispatches when authoritative policy lookup errors', async () => {
    const scenario = await createScenario();
    await entitleTestWorkspace(scenario.workspaceId);
    let failNextSubscriptionLookup = true;
    prisma.$use(async (params, next) => {
      if (
        failNextSubscriptionLookup &&
        params.model === 'Subscription' &&
        params.action === 'findUnique'
      ) {
        failNextSubscriptionLookup = false;
        throw new Error('synthetic lookup failure');
      }
      return next(params);
    });
    let dispatchCalls = 0;
    await expect(
      dispatchWithWorkspaceCapability(
        {
          workspaceId: scenario.workspaceId,
          capability: 'RESEARCH_RUN',
          stage: 'DISPATCH',
          providerMode: 'mock',
        },
        () => {
          dispatchCalls += 1;
          return Promise.resolve('dispatched');
        },
      ),
    ).rejects.toThrow('Operation is not available');
    expect(dispatchCalls).toBe(0);
    const event = await prisma.securityEvent.findFirst({
      where: { workspaceId: scenario.workspaceId, type: 'CAPABILITY_POLICY_REJECTED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(event?.metadata).toMatchObject({ reasonCode: 'POLICY_STATE_UNAVAILABLE' });
  });
});
