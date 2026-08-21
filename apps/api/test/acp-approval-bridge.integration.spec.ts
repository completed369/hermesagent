import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OperationalEventCapability,
  type AcpApprovalBinding,
  type AcpApprovalRequestInput,
} from '@ventureos/agent-control-plane';
import { prisma } from '@ventureos/database';
import { AuditService } from '../src/modules/audit/audit.service';
import {
  AcpApprovalBridgeService,
  AcpApprovalConflictError,
  AcpApprovalDeniedError,
} from '../src/modules/approvals/acp-approval-bridge.service';

describe('governed ACP approval bridge (integration)', () => {
  const suffix = randomUUID();
  const requester = `coo-${suffix}`;
  const issuer = `control-${suffix}`;
  const executor = `runtime-${suffix}`;
  const wrongExecutor = `runtime-wrong-${suffix}`;
  const audit = new AuditService();
  const bridge = new AcpApprovalBridgeService(audit);
  let workspaceId: string;
  let founderId: string;
  let nonFounderId: string;
  let roleId: string;

  const binding = (): AcpApprovalBinding => ({
    workspaceId,
    objectiveId: `objective-${suffix}`,
    taskId: `task-${suffix}`,
    runId: `run-${suffix}`,
    actionCode: 'RELEASE.PREPARE',
    exactTarget: `repo/completed369/hermesagent@${suffix}`,
    artifactVersionId: `artifact-${suffix}`,
    evidenceHash: 'a'.repeat(64),
    policyVersion: 'policy-v1',
    policyHash: 'b'.repeat(64),
  });
  const requestInput = (key: string): AcpApprovalRequestInput => ({
    ...binding(),
    idempotencyKey: key,
    expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
  });

  beforeAll(async () => {
    const workspace = await prisma.workspace.create({
      data: { name: 'ACP approval integration', slug: `acp-approval-${suffix}` },
    });
    workspaceId = workspace.id;
    const permission = await prisma.permission.upsert({
      where: { key: 'approval:decide' },
      update: {},
      create: { key: 'approval:decide', description: 'Decide founder approvals' },
    });
    const role = await prisma.role.create({
      data: {
        key: `ACP_APPROVER_${suffix}`,
        name: 'ACP approval integration founder',
        rolePermissions: { create: { permissionId: permission.id } },
      },
    });
    roleId = role.id;
    const founder = await prisma.user.create({
      data: {
        email: `acp-founder-${suffix}@ventureos.local`,
        displayName: 'ACP Founder',
        isFounder: true,
      },
    });
    founderId = founder.id;
    const nonFounder = await prisma.user.create({
      data: {
        email: `acp-non-founder-${suffix}@ventureos.local`,
        displayName: 'Not Founder',
        isFounder: false,
      },
    });
    nonFounderId = nonFounder.id;
    await prisma.workspaceMember.createMany({
      data: [
        { workspaceId, userId: founderId, roleId },
        { workspaceId, userId: nonFounderId, roleId },
      ],
    });
  });

  afterAll(async () => {
    if (workspaceId) {
      await prisma.auditEvent.deleteMany({ where: { workspaceReference: workspaceId } });
      await prisma.workspace.delete({ where: { id: workspaceId } });
    }
    await prisma.user.deleteMany({
      where: { id: { in: [founderId, nonFounderId].filter(Boolean) } },
    });
    if (roleId) await prisma.role.delete({ where: { id: roleId } });
    await prisma.$disconnect();
  });

  function cooCapability(source: 'AI_COO' | 'CONTROL_PLANE' = 'AI_COO') {
    return OperationalEventCapability.issue(source, [
      { workspaceId, principalId: requester, actorKind: 'AGENT', authorityLevel: 3 },
    ]);
  }

  function controlCapability(principalId = issuer, actorKind: 'AGENT' | 'RUNTIME' = 'AGENT') {
    return OperationalEventCapability.issue('CONTROL_PLANE', [
      { workspaceId, principalId, actorKind },
    ]);
  }

  it('atomically records a scoped request and rejects replay drift and forged source authority', async () => {
    const input = requestInput(`request-${suffix}`);
    const created = await bridge.requestApproval(
      cooCapability(),
      {
        workspaceId,
        principalId: requester,
      },
      input,
    );
    expect(created.replayed).toBe(false);
    expect(created.request.requiredAuthorityLevel).toBe(4);
    expect(created.request.requesterAuthorityLevel).toBe(3);
    const replay = await bridge.requestApproval(
      cooCapability(),
      {
        workspaceId,
        principalId: requester,
      },
      input,
    );
    expect(replay.replayed).toBe(true);
    await expect(
      bridge.requestApproval(
        cooCapability('CONTROL_PLANE'),
        { workspaceId, principalId: requester },
        input,
      ),
    ).rejects.toThrow(/source/i);
    await expect(
      bridge.requestApproval(
        cooCapability(),
        { workspaceId, principalId: requester },
        { ...input, exactTarget: `repo/changed-${suffix}` },
      ),
    ).rejects.toBeInstanceOf(AcpApprovalConflictError);

    const forgedKey = `forged-${suffix}`;
    await expect(
      bridge.requestApproval(
        cooCapability('CONTROL_PLANE'),
        { workspaceId, principalId: requester },
        requestInput(forgedKey),
      ),
    ).rejects.toThrow(/source/i);
    expect(
      await prisma.acpApprovalRequest.count({ where: { workspaceId, idempotencyKey: forgedKey } }),
    ).toBe(0);
    expect(
      await prisma.auditEvent.count({
        where: { workspaceId, action: 'approval.requested', entityId: created.request.id },
      }),
    ).toBe(1);
  });

  it('requires real founder authority and consumes an exact permit once without executing', async () => {
    const input = requestInput(`flow-${suffix}`);
    const { request } = await bridge.requestApproval(
      cooCapability(),
      { workspaceId, principalId: requester },
      input,
    );
    await expect(
      bridge.decideApproval(
        workspaceId,
        request.id,
        nonFounderId,
        'APPROVE',
        `non-founder-${suffix}`,
        binding(),
      ),
    ).rejects.toBeInstanceOf(AcpApprovalDeniedError);
    await expect(
      bridge.decideApproval(workspaceId, request.id, founderId, 'APPROVE', `drift-${suffix}`, {
        ...binding(),
        policyHash: 'c'.repeat(64),
      }),
    ).rejects.toThrow(/policyHash/);

    const approved = await bridge.decideApproval(
      workspaceId,
      request.id,
      founderId,
      'APPROVE',
      `approve-${suffix}`,
      binding(),
    );
    expect(approved.request.state).toBe('APPROVED');
    await expect(
      bridge.decideApproval(
        workspaceId,
        request.id,
        nonFounderId,
        'APPROVE',
        `approve-${suffix}`,
        binding(),
      ),
    ).rejects.toBeInstanceOf(AcpApprovalDeniedError);
    expect(
      (
        await bridge.decideApproval(
          workspaceId,
          request.id,
          founderId,
          'APPROVE',
          `approve-${suffix}`,
          binding(),
        )
      ).replayed,
    ).toBe(true);
    const forgedReplayCapability = OperationalEventCapability.issue('AI_COO', [
      { workspaceId, principalId: issuer, actorKind: 'AGENT' },
    ]);
    await expect(
      bridge.issueExecutionPermit(
        forgedReplayCapability,
        { workspaceId, principalId: issuer },
        request.id,
        binding(),
        executor,
        `permit-${suffix}`,
      ),
    ).rejects.toThrow(/source/i);

    const forgedIssuer = OperationalEventCapability.issue('AI_COO', [
      { workspaceId, principalId: issuer, actorKind: 'AGENT' },
    ]);
    await expect(
      bridge.issueExecutionPermit(
        forgedIssuer,
        { workspaceId, principalId: issuer },
        request.id,
        binding(),
        executor,
        `permit-forged-source-${suffix}`,
      ),
    ).rejects.toThrow(/source/i);
    expect(
      await prisma.acpExecutionPermit.count({
        where: { workspaceId, issueIdempotencyKey: `permit-forged-source-${suffix}` },
      }),
    ).toBe(0);

    await expect(
      bridge.issueExecutionPermit(
        controlCapability(),
        { workspaceId, principalId: issuer },
        request.id,
        { ...binding(), exactTarget: `repo/drift-${suffix}` },
        executor,
        `permit-drift-${suffix}`,
      ),
    ).rejects.toThrow(/exactTarget/);
    const issued = await bridge.issueExecutionPermit(
      controlCapability(),
      { workspaceId, principalId: issuer },
      request.id,
      binding(),
      executor,
      `permit-${suffix}`,
    );
    expect(issued.replayed).toBe(false);
    expect(
      (
        await bridge.issueExecutionPermit(
          controlCapability(),
          { workspaceId, principalId: issuer },
          request.id,
          binding(),
          executor,
          `permit-${suffix}`,
        )
      ).replayed,
    ).toBe(true);

    await expect(
      bridge.claimExecutionPermit(
        controlCapability(wrongExecutor, 'RUNTIME'),
        { workspaceId, principalId: wrongExecutor },
        issued.permit.id,
        binding(),
        `wrong-claim-${suffix}`,
      ),
    ).rejects.toBeInstanceOf(AcpApprovalDeniedError);

    const claims = await Promise.allSettled([
      bridge.claimExecutionPermit(
        controlCapability(executor, 'RUNTIME'),
        { workspaceId, principalId: executor },
        issued.permit.id,
        binding(),
        `claim-a-${suffix}`,
      ),
      bridge.claimExecutionPermit(
        controlCapability(executor, 'RUNTIME'),
        { workspaceId, principalId: executor },
        issued.permit.id,
        binding(),
        `claim-b-${suffix}`,
      ),
    ]);
    expect(claims.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(claims.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const winner = claims.find((result) => result.status === 'fulfilled');
    expect(winner?.status === 'fulfilled' && winner.value.executed).toBe(false);
    const persisted = await prisma.acpExecutionPermit.findUniqueOrThrow({
      where: { id: issued.permit.id },
    });
    expect(persisted.claimedAt).not.toBeNull();
    const claimReplay = await bridge.claimExecutionPermit(
      controlCapability(executor, 'RUNTIME'),
      { workspaceId, principalId: executor },
      issued.permit.id,
      binding(),
      persisted.claimIdempotencyKey!,
    );
    expect(claimReplay.replayed).toBe(true);
    expect(claimReplay.executed).toBe(false);
    expect(
      (await prisma.acpApprovalRequest.findUniqueOrThrow({ where: { id: request.id } })).state,
    ).toBe('PERMIT_CLAIMED');
  });

  it('revokes an issued permit and database guards reject binding tampering', async () => {
    const input = requestInput(`revoke-${suffix}`);
    const { request } = await bridge.requestApproval(
      cooCapability(),
      { workspaceId, principalId: requester },
      input,
    );
    await bridge.decideApproval(
      workspaceId,
      request.id,
      founderId,
      'APPROVE',
      `revoke-approve-${suffix}`,
      binding(),
    );
    const { permit } = await bridge.issueExecutionPermit(
      controlCapability(),
      { workspaceId, principalId: issuer },
      request.id,
      binding(),
      executor,
      `revoke-permit-${suffix}`,
    );
    const revoked = await bridge.decideApproval(
      workspaceId,
      request.id,
      founderId,
      'REVOKE',
      `revoke-decision-${suffix}`,
    );
    expect(revoked.request.state).toBe('REVOKED');
    await expect(
      bridge.issueExecutionPermit(
        controlCapability(),
        { workspaceId, principalId: issuer },
        request.id,
        binding(),
        executor,
        `revoke-permit-${suffix}`,
      ),
    ).rejects.toThrow(/REVOKED/);
    await expect(
      bridge.claimExecutionPermit(
        controlCapability(executor, 'RUNTIME'),
        { workspaceId, principalId: executor },
        permit.id,
        binding(),
        `revoke-claim-${suffix}`,
      ),
    ).rejects.toBeInstanceOf(AcpApprovalDeniedError);

    await expect(
      prisma.$executeRaw`UPDATE "acp_approval_requests" SET "exactTarget" = ${`repo/tampered-${suffix}`} WHERE "id" = ${request.id}::uuid`,
    ).rejects.toThrow(/immutable/i);
    await expect(
      prisma.$executeRaw`UPDATE "acp_approval_requests" SET "state" = 'PENDING' WHERE "id" = ${request.id}::uuid`,
    ).rejects.toThrow(/transition/i);

    const immutableDecisionHash = revoked.decision.decisionHash;
    await prisma.user.delete({ where: { id: founderId } });
    const erasedDecision = await prisma.acpApprovalDecision.findUniqueOrThrow({
      where: { id: revoked.decision.id },
    });
    expect(erasedDecision.approverId).toBeNull();
    expect(erasedDecision.approverReference).toBe(founderId);
    expect(erasedDecision.decisionHash).toBe(immutableDecisionHash);
  });
});
