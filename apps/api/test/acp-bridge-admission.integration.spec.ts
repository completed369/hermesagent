import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OperationalEventCapability,
  type DurableObjectivePlanInput,
} from '@ventureos/agent-control-plane';
import { Prisma, prisma } from '@ventureos/database';
import { DeterministicFakeRuntime } from '../../../packages/agent-bridge/src/__tests__/fixtures/deterministic-fake';
import { AuditService } from '../src/modules/audit/audit.service';
import {
  AcpBridgeAdmissionDeniedError,
  AcpBridgeAdmissionService,
} from '../src/modules/agent-control-plane/acp-bridge-admission.service';
import { AcpTaskRunService } from '../src/modules/agent-control-plane/acp-task-run.service';

describe('durable Agent Bridge admission foundation (PostgreSQL integration)', () => {
  const suffix = randomUUID();
  const principalId = `bridge-control-${suffix}`;
  const runtimeId = `fixture-runtime-${suffix}`;
  const connectionId = `fixture-connection-${suffix}`;
  const sessionId = `fixture-session-${suffix}`;
  const secretReference = `secret-ref-${suffix}`;
  const secret = Buffer.from('synthetic-bridge-secret-material-32bytes!');
  const capabilityPolicyHash = 'a'.repeat(64);
  let workspaceId: string;
  let otherWorkspaceId: string;
  let capability: OperationalEventCapability;
  let bridge: AcpBridgeAdmissionService;
  let taskRuns: AcpTaskRunService;
  let fake: DeterministicFakeRuntime;
  let taskId: string;
  let runId: string;
  let dispatchId: string;
  let level4TaskId: string;
  let level4RunId: string;
  let cancelTaskId: string;
  let cancelRunId: string;
  let primaryAssignmentEvidenceId: string;

  beforeAll(async () => {
    const [workspace, other] = await Promise.all([
      prisma.workspace.create({ data: { name: 'Bridge integration', slug: `bridge-${suffix}` } }),
      prisma.workspace.create({
        data: { name: 'Bridge isolation', slug: `bridge-other-${suffix}` },
      }),
    ]);
    workspaceId = workspace.id;
    otherWorkspaceId = other.id;
    capability = OperationalEventCapability.issue('CONTROL_PLANE', [
      { workspaceId, principalId, actorKind: 'SYSTEM', authorityLevel: 3 },
    ]);
    bridge = new AcpBridgeAdmissionService(
      new AuditService(),
      {
        async resolve(reference) {
          if (reference !== secretReference) throw new Error('unknown synthetic secret reference');
          return secret;
        },
      },
      {
        async verify(evidence) {
          return evidence.evidenceHash === 'b'.repeat(64);
        },
      },
      {
        async verify(_workspace, _runtime, policyHash, codes) {
          return (
            policyHash === capabilityPolicyHash && codes.join(',') === 'health.read,quality.verify'
          );
        },
      },
    );
    taskRuns = new AcpTaskRunService(new AuditService(), bridge, bridge);
  });

  afterAll(async () => {
    if (workspaceId)
      await prisma.workspace.deleteMany({ where: { id: { in: [workspaceId, otherWorkspaceId] } } });
  });

  it('persists a fake-only authenticated admission round trip without promoting runtime truth', async () => {
    const plan: DurableObjectivePlanInput = {
      workspaceId,
      idempotencyKey: `bridge-plan-${suffix}`,
      policyVersion: 'bridge-test-v1',
      objective: {
        id: `bridge-objective-${suffix}`,
        title: 'Verify deterministic bridge',
        desiredOutcome: 'Retain bounded authenticated evidence',
        maximumAuthority: 4,
        costLimit: { currency: 'EUR', maximumMinorUnits: 300, maximumComputeUnits: 300 },
        acceptanceCriteria: ['artifact-one'],
        verificationCriteria: ['artifact-two'],
        stopConditions: ['policy-denial'],
      },
      projects: [{ id: `bridge-project-${suffix}`, title: 'Bridge foundation' }],
      tasks: [
        {
          id: `bridge-task-${suffix}`,
          projectId: `bridge-project-${suffix}`,
          title: 'Exercise deterministic fixture',
          kind: 'quality.verify',
          dependencyIds: [],
          requiredAuthority: 3,
          costLimit: { currency: 'EUR', maximumMinorUnits: 100, maximumComputeUnits: 100 },
          estimatedDurationMs: 1_000,
          acceptanceCriteria: ['artifact-one'],
          verificationCriteria: ['artifact-two'],
          stopConditions: ['policy-denial'],
          retryPolicy: {
            maximumAttempts: 1,
            retryableFailureCodes: [],
            stopAfterFailureCodes: ['POLICY_DENIED'],
          },
          agentPolicy: { templateId: 'fixture-agent', scopes: ['quality.verify'] },
          routingPolicy: { capabilityId: 'quality.verify', maximumLatencyMs: 1_000 },
        },
        {
          id: `bridge-level4-${suffix}`,
          projectId: `bridge-project-${suffix}`,
          title: 'Remain founder gated',
          kind: 'quality.verify',
          dependencyIds: [],
          requiredAuthority: 4,
          costLimit: { currency: 'EUR', maximumMinorUnits: 100, maximumComputeUnits: 100 },
          estimatedDurationMs: 1_000,
          acceptanceCriteria: ['level4-artifact'],
          verificationCriteria: ['level4-verification'],
          stopConditions: ['policy-denial'],
          retryPolicy: {
            maximumAttempts: 1,
            retryableFailureCodes: [],
            stopAfterFailureCodes: ['POLICY_DENIED'],
          },
          agentPolicy: { templateId: 'fixture-agent', scopes: ['quality.verify'] },
          routingPolicy: { capabilityId: 'quality.verify', maximumLatencyMs: 1_000 },
          approval: {
            actionCode: 'PRODUCTION.DEPLOY',
            exactTarget: `production/fixture/${suffix}`,
            artifactVersionId: `release-${suffix}`,
            evidenceHash: 'f'.repeat(64),
          },
        },
        {
          id: `bridge-cancel-${suffix}`,
          projectId: `bridge-project-${suffix}`,
          title: 'Exercise bounded cancellation',
          kind: 'quality.verify',
          dependencyIds: [],
          requiredAuthority: 3,
          costLimit: { currency: 'EUR', maximumMinorUnits: 100, maximumComputeUnits: 100 },
          estimatedDurationMs: 1_000,
          acceptanceCriteria: ['cancel-evidence'],
          verificationCriteria: ['cancel-verification'],
          stopConditions: ['policy-denial'],
          retryPolicy: {
            maximumAttempts: 1,
            retryableFailureCodes: [],
            stopAfterFailureCodes: ['POLICY_DENIED'],
          },
          agentPolicy: { templateId: 'fixture-agent', scopes: ['quality.verify'] },
          routingPolicy: { capabilityId: 'quality.verify', maximumLatencyMs: 1_000 },
        },
      ],
    };
    const created = await taskRuns.createPlan(capability, { workspaceId, principalId }, plan);
    taskId = created.objective.tasks[0]!.id;
    runId = created.objective.tasks[0]!.runs[0]!.id;
    level4TaskId = created.objective.tasks[1]!.id;
    level4RunId = created.objective.tasks[1]!.runs[0]!.id;
    cancelTaskId = created.objective.tasks[2]!.id;
    cancelRunId = created.objective.tasks[2]!.runs[0]!.id;

    const provisioned = await bridge.provisionRuntime(
      capability,
      { workspaceId, principalId },
      {
        runtimeId,
        connectionId,
        adapterKind: 'DETERMINISTIC_FAKE',
        environment: 'TEST_ONLY',
        principalReference: `fixture-principal-${suffix}`,
        secretReference,
        capabilityPolicyHash,
        idempotencyKey: `provision-${suffix}`,
      },
    );
    expect(provisioned.runtime.status).toBe('NOT_CONFIGURED');
    expect(provisioned.connection.status).toBe('NOT_CONFIGURED');

    const now = new Date();
    const parentNonce = `parent_nonce_${suffix.replaceAll('-', '')}`;
    const runtimeNonce = `runtime_nonce_${suffix.replaceAll('-', '')}`;
    await bridge.openSession(
      capability,
      { workspaceId, principalId },
      {
        sessionId,
        connectionId,
        parentNonce,
        expiresAt: new Date(now.getTime() + 240_000).toISOString(),
      },
    );
    fake = new DeterministicFakeRuntime(
      {
        workspaceId,
        runtimeId,
        connectionId,
        sessionId,
        principalReference: `fixture-principal-${suffix}`,
        parentNonce,
        runtimeNonce,
      },
      secret,
      now,
    );
    await bridge.authenticateSession(
      capability,
      { workspaceId, principalId },
      fake.emit('AUTHENTICATE', { parentNonce, runtimeNonce }),
    );
    await bridge.acceptRuntimeMessage(
      capability,
      { workspaceId, principalId },
      fake.emit('CAPABILITIES', { capabilityCodes: ['health.read', 'quality.verify'] }),
    );
    const heartbeat = fake.emit('HEARTBEAT', { health: 'HEALTHY' });
    const heartbeatRace = await Promise.allSettled([
      bridge.acceptRuntimeMessage(capability, { workspaceId, principalId }, heartbeat),
      bridge.acceptRuntimeMessage(capability, { workspaceId, principalId }, heartbeat),
    ]);
    expect(heartbeatRace.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(heartbeatRace.filter((result) => result.status === 'rejected')).toHaveLength(1);

    const connection = await prisma.acpRuntimeConnection.findUniqueOrThrow({
      where: { workspaceId_id: { workspaceId, id: connectionId } },
    });
    expect(connection.status).toBe('PARTIAL');
    expect(
      (
        await prisma.acpRuntime.findUniqueOrThrow({
          where: { workspaceId_id: { workspaceId, id: runtimeId } },
        })
      ).status,
    ).toBe('NOT_CONFIGURED');

    dispatchId = `dispatch-${suffix}`;
    const prepared = await bridge.prepareDispatch(
      capability,
      { workspaceId, principalId },
      {
        dispatchId,
        agentId: `fixture-agent-${suffix}`,
        sessionId,
        idempotencyKey: `dispatch-idempotency-${suffix}`,
        brokerEvidence: {
          evidenceId: `broker-${suffix}`,
          evidenceHash: 'b'.repeat(64),
          workspaceId,
          taskId,
          runId,
          runtimeId,
          connectionId,
        },
      },
    );
    const assignmentEvidenceId = prepared.dispatch.assignmentEvidenceId;
    primaryAssignmentEvidenceId = assignmentEvidenceId;
    await bridge.acceptRuntimeMessage(
      capability,
      { workspaceId, principalId },
      fake.emit('DISPATCH_ACCEPTED', {
        dispatchId,
        taskId,
        runId,
        evidenceId: assignmentEvidenceId,
        assignmentEvidenceHash: prepared.dispatch.assignmentEvidenceHash,
      }),
    );
    const assignment = {
      evidenceId: assignmentEvidenceId,
      evidenceHash: prepared.dispatch.assignmentEvidenceHash,
      taskId,
      runId,
      agentId: `fixture-agent-${suffix}`,
      runtimeId,
      connectionId,
    };
    expect(await bridge.verify(workspaceId, assignment)).toBe(true);
    const assigned = await taskRuns.reserveAssignment(
      capability,
      { workspaceId, principalId },
      assignment,
      1,
      `reserve-${suffix}`,
    );
    await taskRuns.startRun(
      capability,
      { workspaceId, principalId },
      runId,
      assigned.run.version,
      `start-${suffix}`,
    );

    for (const [index, criterion] of ['artifact-one', 'artifact-two'].entries()) {
      const evidence = {
        evidenceId: `artifact-evidence-${index}-${suffix}`,
        evidenceHash: `${index + 1}`.repeat(64),
        taskId,
        runId,
        artifactId: `artifact-${index}-${suffix}`,
        criterion,
        kind: 'TEST_EVIDENCE',
        uriReference: `artifact://fixture/${index}/${suffix}`,
        contentHash: `${index + 3}`.repeat(64),
      };
      await bridge.acceptRuntimeMessage(
        capability,
        { workspaceId, principalId },
        fake.emit('ARTIFACT', { dispatchId, ...evidence }),
      );
      expect(await bridge.verify(workspaceId, evidence)).toBe(true);
      await taskRuns.recordArtifact(
        capability,
        { workspaceId, principalId },
        evidence,
        `record-artifact-${index}-${suffix}`,
      );
    }
    await bridge.acceptRuntimeMessage(
      capability,
      { workspaceId, principalId },
      fake.emit('USAGE', {
        dispatchId,
        taskId,
        runId,
        computeUnits: 10,
        costMinorUnits: 5,
        currency: 'EUR',
      }),
    );
    await expect(
      bridge.acceptRuntimeMessage(
        capability,
        { workspaceId, principalId },
        fake.emitAt(8, 'USAGE', {
          dispatchId,
          taskId,
          runId,
          computeUnits: 1,
          costMinorUnits: 101,
          currency: 'EUR',
        }),
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    expect(
      await prisma.acpBridgeReceipt.count({
        where: { workspaceId, sessionId, sequence: 8 },
      }),
    ).toBe(0);
    await bridge.acceptRuntimeMessage(
      capability,
      { workspaceId, principalId },
      fake.emit('RESULT', { dispatchId, resultCode: 'SUCCESS' }),
    );
    const running = await prisma.acpRun.findUniqueOrThrow({
      where: { workspaceId_id: { workspaceId, id: runId } },
    });
    await taskRuns.completeRun(
      capability,
      { workspaceId, principalId },
      runId,
      running.version,
      `complete-${suffix}`,
    );

    const cancelDispatchId = `cancel-dispatch-${suffix}`;
    const cancelPrepared = await bridge.prepareDispatch(
      capability,
      { workspaceId, principalId },
      {
        dispatchId: cancelDispatchId,
        agentId: `fixture-agent-${suffix}`,
        sessionId,
        idempotencyKey: `cancel-dispatch-idempotency-${suffix}`,
        brokerEvidence: {
          evidenceId: `cancel-broker-${suffix}`,
          evidenceHash: 'b'.repeat(64),
          workspaceId,
          taskId: cancelTaskId,
          runId: cancelRunId,
          runtimeId,
          connectionId,
        },
      },
    );
    await bridge.acceptRuntimeMessage(
      capability,
      { workspaceId, principalId },
      fake.emit('DISPATCH_ACCEPTED', {
        dispatchId: cancelDispatchId,
        taskId: cancelTaskId,
        runId: cancelRunId,
        evidenceId: `cancel-assignment-${suffix}`,
        assignmentEvidenceHash: cancelPrepared.dispatch.assignmentEvidenceHash,
      }),
    );
    const cancellation = await bridge.requestCancellation(
      capability,
      { workspaceId, principalId },
      cancelDispatchId,
      `cancel-${suffix}`,
    );
    expect(cancellation.dispatch.state).toBe('CANCEL_REQUESTED');
    await bridge.acceptRuntimeMessage(
      capability,
      { workspaceId, principalId },
      fake.emit('CANCELLED', { dispatchId: cancelDispatchId, resultCode: 'CANCELLED_BY_POLICY' }),
    );
    expect(
      (
        await prisma.acpBridgeDispatch.findUniqueOrThrow({
          where: { workspaceId_id: { workspaceId, id: cancelDispatchId } },
        })
      ).state,
    ).toBe('CANCELLED');

    expect(await prisma.acpBridgeReceipt.count({ where: { workspaceId, sessionId } })).toBe(10);
    expect(
      (
        await prisma.acpBridgeDispatch.findUniqueOrThrow({
          where: { workspaceId_id: { workspaceId, id: dispatchId } },
        })
      ).state,
    ).toBe('COMPLETED');
    expect(await prisma.acpRunUsage.count({ where: { workspaceId, runId } })).toBe(1);
    const runtime = await prisma.acpRuntime.findUniqueOrThrow({
      where: { workspaceId_id: { workspaceId, id: runtimeId } },
    });
    expect(runtime.secretReference).toBe(secretReference);
    expect(runtime.secretDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(runtime)).not.toContain(secret.toString('utf8'));
  });

  it('rejects replay, post-terminal facts, cross-workspace evidence, and immutable receipt mutation', async () => {
    const postTerminal = fake.emit('PROGRESS', { dispatchId, progressCode: 'LATE' });
    await expect(
      bridge.acceptRuntimeMessage(capability, { workspaceId, principalId }, postTerminal),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    await expect(
      bridge.acceptRuntimeMessage(capability, { workspaceId, principalId }, postTerminal),
    ).rejects.toThrow();
    expect(
      await prisma.acpBridgeReceipt.findFirst({
        where: { workspaceId, messageId: postTerminal.messageId },
      }),
    ).toBeNull();
    const receipt = await prisma.acpBridgeReceipt.findFirstOrThrow({
      where: { workspaceId, sessionId },
    });
    await expect(
      prisma.acpBridgeReceipt.update({
        where: { workspaceId_id: { workspaceId, id: receipt.id } },
        data: { messageId: `drift-${suffix}` },
      }),
    ).rejects.toThrow();
    expect(
      await bridge.verify(otherWorkspaceId, {
        evidenceId: primaryAssignmentEvidenceId,
        evidenceHash: (
          await prisma.acpBridgeDispatch.findUniqueOrThrow({
            where: { workspaceId_id: { workspaceId, id: dispatchId } },
          })
        ).assignmentEvidenceHash,
        taskId,
        runId,
        agentId: `fixture-agent-${suffix}`,
        runtimeId,
        connectionId,
      }),
    ).toBe(false);
  });

  it('denies real named runtime provisioning and Level-4 dispatch admission', async () => {
    await expect(
      bridge.provisionRuntime(
        capability,
        { workspaceId, principalId },
        {
          runtimeId: `codex:${suffix}`,
          connectionId: `codex-connection-${suffix}`,
          adapterKind: 'PROTOCOL_NEUTRAL',
          environment: 'TEST_ONLY',
          principalReference: `codex-principal-${suffix}`,
          secretReference,
          capabilityPolicyHash,
          idempotencyKey: `codex-${suffix}`,
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    expect(
      await prisma.acpRuntime.count({ where: { workspaceId, id: { startsWith: 'codex' } } }),
    ).toBe(0);
    await expect(
      bridge.prepareDispatch(
        capability,
        { workspaceId, principalId },
        {
          dispatchId: `level4-dispatch-${suffix}`,
          agentId: `fixture-agent-${suffix}`,
          sessionId,
          idempotencyKey: `level4-dispatch-${suffix}`,
          brokerEvidence: {
            evidenceId: `level4-broker-${suffix}`,
            evidenceHash: 'b'.repeat(64),
            workspaceId,
            taskId: level4TaskId,
            runId: level4RunId,
            runtimeId,
            connectionId,
          },
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    expect(
      await prisma.acpBridgeDispatch.count({ where: { workspaceId, runId: level4RunId } }),
    ).toBe(0);
  });

  it('samples the database clock after a waited connection lock and rejects crossed expiry', async () => {
    const expirySessionId = `expiry-session-${suffix}`;
    const openedAt = new Date();
    const expiresAt = new Date(openedAt.getTime() + 2_500);
    const parentNonce = `expiry_parent_${suffix.replaceAll('-', '')}`;
    const runtimeNonce = `expiry_runtime_${suffix.replaceAll('-', '')}`;
    await bridge.openSession(
      capability,
      { workspaceId, principalId },
      {
        sessionId: expirySessionId,
        connectionId,
        parentNonce,
        expiresAt: expiresAt.toISOString(),
      },
    );
    const expiryFake = new DeterministicFakeRuntime(
      {
        workspaceId,
        runtimeId,
        connectionId,
        sessionId: expirySessionId,
        principalReference: `fixture-principal-${suffix}`,
        parentNonce,
        runtimeNonce,
      },
      secret,
      openedAt,
    );
    await bridge.authenticateSession(
      capability,
      { workspaceId, principalId },
      expiryFake.emit('AUTHENTICATE', { parentNonce, runtimeNonce }),
    );

    let releaseLock!: () => void;
    let reportLocked!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      reportLocked = resolve;
    });
    const blocker = prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "acp_runtime_connections" WHERE "workspaceId" = ${workspaceId}::uuid AND "id" = ${connectionId} FOR UPDATE`,
      );
      reportLocked();
      await release;
    });
    await locked;
    const capabilityFrame = expiryFake.emit('CAPABILITIES', {
      capabilityCodes: ['health.read', 'quality.verify'],
    });
    const attempt = bridge.acceptRuntimeMessage(
      capability,
      { workspaceId, principalId },
      capabilityFrame,
    );
    await new Promise<void>((resolve) =>
      setTimeout(resolve, Math.max(1, expiresAt.getTime() - Date.now() + 150)),
    );
    releaseLock();
    await blocker;
    await expect(attempt).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    expect(
      await prisma.acpBridgeReceipt.findFirst({
        where: { workspaceId, sessionId: expirySessionId, sequence: 2 },
      }),
    ).toBeNull();
  });

  it('cascades tenant erasure across bridge evidence while audit retains governed references', async () => {
    const erase = await prisma.workspace.create({
      data: { name: 'Bridge erase', slug: `bridge-erase-${suffix}` },
    });
    const eraseCapability = OperationalEventCapability.issue('CONTROL_PLANE', [
      { workspaceId: erase.id, principalId, actorKind: 'SYSTEM', authorityLevel: 3 },
    ]);
    const eraseBridge = new AcpBridgeAdmissionService(
      new AuditService(),
      {
        async resolve() {
          return secret;
        },
      },
      {
        async verify() {
          return false;
        },
      },
      {
        async verify() {
          return false;
        },
      },
    );
    await eraseBridge.provisionRuntime(
      eraseCapability,
      { workspaceId: erase.id, principalId },
      {
        runtimeId: `erase-runtime-${suffix}`,
        connectionId: `erase-connection-${suffix}`,
        adapterKind: 'DETERMINISTIC_FAKE',
        environment: 'TEST_ONLY',
        principalReference: `erase-principal-${suffix}`,
        secretReference: `erase-secret-ref-${suffix}`,
        capabilityPolicyHash,
        idempotencyKey: `erase-${suffix}`,
      },
    );
    await prisma.workspace.delete({ where: { id: erase.id } });
    expect(await prisma.acpRuntime.count({ where: { workspaceId: erase.id } })).toBe(0);
    expect(
      (await prisma.auditEvent.findFirstOrThrow({ where: { workspaceReference: erase.id } }))
        .workspaceId,
    ).toBeNull();
  });

  it('rolls back runtime state when atomic audit persistence fails', async () => {
    const rollback = await prisma.workspace.create({
      data: { name: 'Bridge rollback', slug: `bridge-rollback-${suffix}` },
    });
    const rollbackCapability = OperationalEventCapability.issue('CONTROL_PLANE', [
      {
        workspaceId: rollback.id,
        principalId,
        actorKind: 'SYSTEM',
        authorityLevel: 3,
      },
    ]);
    const failingAudit = {
      async recordOperationalEvent() {
        throw new Error('synthetic audit failure');
      },
    } as AuditService;
    const rollbackBridge = new AcpBridgeAdmissionService(
      failingAudit,
      {
        async resolve() {
          return secret;
        },
      },
      {
        async verify() {
          return false;
        },
      },
      {
        async verify() {
          return false;
        },
      },
    );
    await expect(
      rollbackBridge.provisionRuntime(
        rollbackCapability,
        { workspaceId: rollback.id, principalId },
        {
          runtimeId: `rollback-runtime-${suffix}`,
          connectionId: `rollback-connection-${suffix}`,
          adapterKind: 'DETERMINISTIC_FAKE',
          environment: 'TEST_ONLY',
          principalReference: `rollback-principal-${suffix}`,
          secretReference: `rollback-secret-${suffix}`,
          capabilityPolicyHash,
          idempotencyKey: `rollback-${suffix}`,
        },
      ),
    ).rejects.toThrow('synthetic audit failure');
    expect(await prisma.acpRuntime.count({ where: { workspaceId: rollback.id } })).toBe(0);
    await prisma.workspace.delete({ where: { id: rollback.id } });
  });
});
