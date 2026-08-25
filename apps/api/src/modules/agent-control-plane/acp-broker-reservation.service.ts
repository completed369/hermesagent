import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  BROKER_RESERVATION_TTL_MS,
  RuntimeBroker,
  TRUSTED_BROKER_CANDIDATE_READER,
  buildBrokerReservationBinding,
  computeBrokerReservationEvidenceHash,
  validateAcpApprovalReference,
  type OperationalEventCapability,
  type RuntimeRoutingCandidate,
  type RuntimeRoutingRequest,
  type TrustedBrokerCandidateReader,
  type WorkspaceContext,
} from '@ventureos/agent-control-plane';
import type {
  BridgeBrokerEvidenceVerifier,
  BridgeTestOnlyGate,
  TrustedBridgeBrokerEvidence,
} from '@ventureos/agent-bridge';
import { BRIDGE_TEST_ONLY_GATE } from '@ventureos/agent-bridge';
import { Prisma, prisma } from '@ventureos/database';
import type { AuditService } from '../audit/audit.service';
import { AUDIT_SERVICE } from '../audit/audit.tokens';

export class AcpBrokerReservationError extends Error {}
export class AcpBrokerReservationDeniedError extends AcpBrokerReservationError {}
export class AcpBrokerReservationConflictError extends AcpBrokerReservationError {}
export class AcpBrokerReservationNotFoundError extends AcpBrokerReservationError {}

export interface ReserveBrokerRouteInput {
  readonly reservationId: string;
  readonly runId: string;
  readonly agentId: string;
  readonly expectedRunVersion: number;
  readonly idempotencyKey: string;
}

function assertControlPlane(
  capability: OperationalEventCapability,
  context: WorkspaceContext,
): 'HUMAN' | 'AGENT' | 'SYSTEM' {
  capability.assertSource('CONTROL_PLANE');
  const actorKind = capability.actorKindFor(context);
  if (actorKind === 'RUNTIME' || capability.authorityLevelFor(context) < 3)
    throw new AcpBrokerReservationDeniedError('Level-3 trusted control-plane authority required');
  return actorKind;
}

function number(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new AcpBrokerReservationDeniedError('Durable task budget exceeds safe broker bounds');
  return Number(value);
}

function routingRequest(run: {
  id: string;
  workspaceId: string;
  task: {
    routingPolicy: unknown;
    maximumCostMinorUnits: bigint;
    maximumComputeUnits: bigint;
  };
}): RuntimeRoutingRequest {
  const policy = run.task.routingPolicy as Record<string, unknown>;
  const capabilityIds = Array.isArray(policy.requiredCapabilityIds)
    ? policy.requiredCapabilityIds
    : typeof policy.capabilityId === 'string'
      ? [policy.capabilityId]
      : [];
  const tools = Array.isArray(policy.requiredTools) ? policy.requiredTools : [];
  return {
    id: `broker:${run.id}`,
    workspaceId: run.workspaceId,
    requiredCapabilityIds: capabilityIds as string[],
    requiredTools: tools as { toolId: string; scope: string }[],
    dataSensitivity:
      policy.dataSensitivity === 'PUBLIC' ||
      policy.dataSensitivity === 'CONFIDENTIAL' ||
      policy.dataSensitivity === 'RESTRICTED'
        ? policy.dataSensitivity
        : 'INTERNAL',
    minimumSecurityTier:
      typeof policy.minimumSecurityTier === 'number'
        ? (policy.minimumSecurityTier as 0 | 1 | 2 | 3)
        : 0,
    minimumReliabilityScoreBps:
      typeof policy.minimumReliabilityScoreBps === 'number' ? policy.minimumReliabilityScoreBps : 0,
    maximumLatencyMs:
      typeof policy.maximumLatencyMs === 'number' ? policy.maximumLatencyMs : 60_000,
    maximumCostMinorUnits: number(run.task.maximumCostMinorUnits),
    requiredComputeUnits: number(run.task.maximumComputeUnits),
    heartbeatFreshnessMs:
      typeof policy.heartbeatFreshnessMs === 'number' ? policy.heartbeatFreshnessMs : 60_000,
    ...(policy.weights && typeof policy.weights === 'object'
      ? { weights: policy.weights as RuntimeRoutingRequest['weights'] }
      : {}),
  };
}

async function databaseNow(tx: Prisma.TransactionClient): Promise<Date> {
  const [row] = await tx.$queryRaw<Array<{ now: Date }>>(
    Prisma.sql`SELECT clock_timestamp() AS now`,
  );
  if (!row) throw new AcpBrokerReservationError('Database clock unavailable');
  return row.now;
}

@Injectable()
export class AcpBrokerReservationService implements BridgeBrokerEvidenceVerifier {
  constructor(
    @Inject(AUDIT_SERVICE) private readonly auditService: AuditService,
    @Inject(TRUSTED_BROKER_CANDIDATE_READER)
    private readonly candidateReader: TrustedBrokerCandidateReader,
    @Inject(BRIDGE_TEST_ONLY_GATE) private readonly testOnlyGate: BridgeTestOnlyGate,
  ) {}

  async reserveForPreparedRun(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    input: ReserveBrokerRouteInput,
  ) {
    const actorKind = assertControlPlane(capability, context);
    validateAcpApprovalReference(input.reservationId, 'reservationId');
    validateAcpApprovalReference(input.runId, 'runId');
    validateAcpApprovalReference(input.agentId, 'agentId');
    validateAcpApprovalReference(input.idempotencyKey, 'idempotencyKey');
    if (!Number.isSafeInteger(input.expectedRunVersion) || input.expectedRunVersion < 1)
      throw new AcpBrokerReservationDeniedError('Expected run version is invalid');

    const existing = await prisma.acpBrokerReservation.findUnique({
      where: {
        workspaceId_idempotencyKey: {
          workspaceId: context.workspaceId,
          idempotencyKey: input.idempotencyKey,
        },
      },
      include: { evaluations: { orderBy: { ordinal: 'asc' } } },
    });
    if (existing) {
      if (
        existing.id !== input.reservationId ||
        existing.runId !== input.runId ||
        existing.agentId !== input.agentId
      )
        throw new AcpBrokerReservationConflictError('Broker reservation replay drifted');
      return { reservation: existing, replayed: true };
    }

    return prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "acp_runs" WHERE "workspaceId"=${context.workspaceId}::uuid AND "id"=${input.runId} FOR UPDATE`,
        );
        let run = await tx.acpRun.findUnique({
          where: { workspaceId_id: { workspaceId: context.workspaceId, id: input.runId } },
          include: { task: true },
        });
        if (!run) throw new AcpBrokerReservationNotFoundError('Prepared run not found');
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "acp_tasks" WHERE "workspaceId"=${context.workspaceId}::uuid AND "id"=${run.taskId} FOR UPDATE`,
        );
        run = await tx.acpRun.findUniqueOrThrow({
          where: { workspaceId_id: { workspaceId: context.workspaceId, id: input.runId } },
          include: { task: true },
        });
        if (
          run.version !== input.expectedRunVersion ||
          run.status !== 'PREPARED' ||
          run.task.status !== 'READY' ||
          run.requiredAuthority >= 4 ||
          run.assignedAgentId ||
          run.assignedRuntimeId ||
          run.assignedConnectionId
        )
          throw new AcpBrokerReservationDeniedError(
            'Only exact ready unassigned Level 0-3 runs may be routed',
          );

        const firstSnapshot = await this.candidateReader.read(context.workspaceId);
        if (
          firstSnapshot.testOnly &&
          !(await this.testOnlyGate.allowsDeterministicFixture(context.workspaceId))
        )
          throw new AcpBrokerReservationDeniedError('Test-only broker evidence denied');
        const request = routingRequest(run);
        const firstDecision = this.route(context, request, firstSnapshot.candidates);
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "acp_runtime_connections" WHERE "workspaceId"=${context.workspaceId}::uuid AND "id"=${firstDecision.selectedConnectionId} FOR UPDATE`,
        );
        const connection = await tx.acpRuntimeConnection.findUnique({
          where: {
            workspaceId_id: {
              workspaceId: context.workspaceId,
              id: firstDecision.selectedConnectionId,
            },
          },
        });
        if (!connection || connection.runtimeId !== firstDecision.selectedRuntimeId)
          throw new AcpBrokerReservationDeniedError('Selected runtime connection is not durable');
        const snapshot = await this.candidateReader.read(context.workspaceId);
        if (snapshot.evidenceHash !== firstSnapshot.evidenceHash)
          throw new AcpBrokerReservationDeniedError(
            'Broker candidate evidence changed during reservation',
          );
        const decision = this.route(context, request, snapshot.candidates);
        if (
          decision.selectedRuntimeId !== firstDecision.selectedRuntimeId ||
          decision.selectedConnectionId !== firstDecision.selectedConnectionId
        )
          throw new AcpBrokerReservationDeniedError('Broker selection changed during reservation');
        const selected = snapshot.candidates.find(
          (candidate) =>
            candidate.runtimeId === decision.selectedRuntimeId &&
            candidate.connectionId === decision.selectedConnectionId,
        )!;
        const now = await databaseNow(tx);
        await tx.acpBrokerReservation.updateMany({
          where: {
            workspaceId: context.workspaceId,
            connectionId: selected.connectionId,
            state: 'RESERVED',
            expiresAt: { lte: now },
          },
          data: { state: 'EXPIRED', releasedAt: now },
        });
        const active = await tx.acpBrokerReservation.aggregate({
          where: {
            workspaceId: context.workspaceId,
            connectionId: selected.connectionId,
            OR: [{ state: 'CLAIMED' }, { state: 'RESERVED', expiresAt: { gt: now } }],
          },
          _count: true,
          _sum: { estimatedCostMinorUnits: true, reservedComputeUnits: true },
        });
        if (selected.activeRuns + active._count >= selected.maxConcurrentRuns)
          throw new AcpBrokerReservationDeniedError('Runtime capacity reservation denied');
        if (
          (active._sum.estimatedCostMinorUnits ?? 0n) + BigInt(selected.estimatedCostMinorUnits) >
            BigInt(selected.remainingBudgetMinorUnits) ||
          (active._sum.reservedComputeUnits ?? 0n) + BigInt(request.requiredComputeUnits) >
            BigInt(selected.remainingComputeUnits)
        )
          throw new AcpBrokerReservationDeniedError('Runtime budget reservation denied');

        const binding = buildBrokerReservationBinding({
          workspaceId: context.workspaceId,
          objectiveId: run.objectiveId,
          taskId: run.taskId,
          runId: run.id,
          agentId: input.agentId,
          taskPolicyHash: run.policyHash,
          taskPolicyVersion: run.policyVersion,
          request,
          snapshot,
          decision,
        });
        const evidenceHash = computeBrokerReservationEvidenceHash(binding);
        const reservation = await tx.acpBrokerReservation.create({
          data: {
            id: input.reservationId,
            ...binding,
            evidenceHash,
            idempotencyKey: input.idempotencyKey,
            expiresAt: new Date(now.getTime() + BROKER_RESERVATION_TTL_MS),
            evaluations: {
              create: decision.evaluations.map((evaluation, ordinal) => ({
                id: randomUUID(),
                runtimeId: evaluation.runtimeId,
                connectionId: evaluation.connectionId,
                eligible: evaluation.eligible,
                rejectionReasons: [...evaluation.rejectionReasons],
                scoreBps: evaluation.scoreBps,
                qualityBps: evaluation.scoreFactors?.quality,
                reliabilityBps: evaluation.scoreFactors?.reliability,
                securityBps: evaluation.scoreFactors?.security,
                latencyBps: evaluation.scoreFactors?.latency,
                costBps: evaluation.scoreFactors?.cost,
                workloadBps: evaluation.scoreFactors?.workload,
                ordinal,
              })),
            },
          },
          include: { evaluations: { orderBy: { ordinal: 'asc' } } },
        });
        await this.auditService.recordOperationalEvent(
          capability,
          context,
          {
            id: randomUUID(),
            workspaceId: context.workspaceId,
            type: 'run.progress',
            source: 'CONTROL_PLANE',
            actorKind,
            actorId: context.principalId,
            subjectType: 'AcpBrokerReservation',
            subjectId: reservation.id,
            occurredAt: now.toISOString(),
            idempotencyKey: `broker-reservation:${input.idempotencyKey}`,
            correlationId: run.id,
            facts: { payloadFieldCount: decision.evaluations.length, payloadBytes: 0 },
          },
          actorKind === 'HUMAN' ? context.principalId : undefined,
          tx,
        );
        return { reservation, replayed: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async verify(evidence: TrustedBridgeBrokerEvidence): Promise<boolean> {
    const reservation = await prisma.acpBrokerReservation.findUnique({
      where: { workspaceId_id: { workspaceId: evidence.workspaceId, id: evidence.evidenceId } },
    });
    if (!reservation) return false;
    const recomputedHash = computeBrokerReservationEvidenceHash({
      workspaceId: reservation.workspaceId,
      objectiveId: reservation.objectiveId,
      taskId: reservation.taskId,
      runId: reservation.runId,
      agentId: reservation.agentId,
      runtimeId: reservation.runtimeId,
      connectionId: reservation.connectionId,
      requestHash: reservation.requestHash,
      candidateEvidenceId: reservation.candidateEvidenceId,
      candidateEvidenceHash: reservation.candidateEvidenceHash,
      taskPolicyHash: reservation.taskPolicyHash,
      taskPolicyVersion: reservation.taskPolicyVersion,
      selectedScoreBps: reservation.selectedScoreBps,
      estimatedCostMinorUnits: number(reservation.estimatedCostMinorUnits),
      reservedComputeUnits: number(reservation.reservedComputeUnits),
      maxConcurrentRuns: reservation.maxConcurrentRuns,
      testOnly: reservation.testOnly,
    });
    return (
      reservation.evidenceHash === evidence.evidenceHash &&
      reservation.evidenceHash === recomputedHash &&
      reservation.taskId === evidence.taskId &&
      reservation.runId === evidence.runId &&
      reservation.agentId === evidence.agentId &&
      reservation.runtimeId === evidence.runtimeId &&
      reservation.connectionId === evidence.connectionId &&
      ((reservation.state === 'RESERVED' && reservation.expiresAt > new Date()) ||
        reservation.state === 'CLAIMED')
    );
  }

  private route(
    context: WorkspaceContext,
    request: RuntimeRoutingRequest,
    candidates: readonly RuntimeRoutingCandidate[],
  ) {
    const broker = new RuntimeBroker({ authorityPrincipals: [context.principalId] });
    for (const candidate of candidates) broker.putCandidateEvidence(context, candidate);
    return broker.route(context, request);
  }
}
