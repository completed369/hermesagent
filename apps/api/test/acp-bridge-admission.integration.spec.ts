import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OperationalEventCapability,
  computeBrokerReservationEvidenceHash,
  costBudgetPolicyHash,
  sha256Canonical,
  type DurableObjectivePlanInput,
  type RuntimeRoutingCandidate,
  type TrustedBrokerCandidateSnapshot,
  type TrustedBrokerAgentReader,
} from '@ventureos/agent-control-plane';
import { Prisma, prisma } from '@ventureos/database';
import {
  BRIDGE_PROTOCOL_VERSION,
  CODEX_APP_SERVER_ADAPTER_KIND,
  CODEX_APP_SERVER_ARGUMENT_POLICY,
  CODEX_APP_SERVER_ARGV,
  BridgeProtocolError,
  codexCapabilityExchangeAuthorizationRequestHash,
  codexRegistrationAuthorizationRequestHash,
  codexValidationDispatchAuthorizationRequestHash,
  createCodexCapabilityExchangeCandidate,
  createCodexAuthenticatedRegistrationCandidate,
  createCodexHeartbeatEvidenceCandidate,
  createCodexValidationProcessCleanupEvidence,
  createCodexValidationDispatchCandidate,
  deriveBridgeKeys,
  DenyBridgeSecretLeaseResolver,
  digestBridgePayload,
  digestSecretReference,
  encodeBridgeLine,
  ScopedBridgeSecretLeaseResolver,
  signBridgeEnvelope,
  validateCodexAppServerManifest,
  verifyBridgeEnvelope,
  type BridgeSecretLeaseRequest,
  type BridgeSecretLeaseResolver,
  type CodexCapabilityExchangeAuthorizationRequest,
  type CodexCapabilityExchangeAuthorizationSource,
  type CodexRegistrationAuthorizationRequest,
  type CodexRegistrationAuthorizationSource,
  type CodexValidationDispatchAuthorizationRequest,
  type CodexValidationDispatchAuthorizationSource,
} from '@ventureos/agent-bridge';
import { DeterministicFakeRuntime } from '../../../packages/agent-bridge/src/__tests__/fixtures/deterministic-fake';
import { deterministicLinuxAdmission } from '../../../packages/agent-bridge/src/__tests__/fixtures/deterministic-supervision';
import { AuditService } from '../src/modules/audit/audit.service';
import {
  AcpBridgeAdmissionDeniedError,
  AcpBridgeAdmissionConflictError,
  AcpBridgeAdmissionService,
} from '../src/modules/agent-control-plane/acp-bridge-admission.service';
import { AcpBrokerReservationService } from '../src/modules/agent-control-plane/acp-broker-reservation.service';
import { AcpTaskRunService } from '../src/modules/agent-control-plane/acp-task-run.service';
import {
  AcpCostGovernanceService,
  AcpCostLedgerQueryService,
} from '../src/modules/agent-control-plane/acp-cost-governance.service';

describe('durable Agent Bridge admission foundation (PostgreSQL integration)', () => {
  const suffix = randomUUID();
  const principalId = `bridge-control-${suffix}`;
  const runtimeId = `fixture-runtime-${suffix}`;
  const connectionId = `fixture-connection-${suffix}`;
  const sessionId = `fixture-session-${suffix}`;
  const secretReference = `vault-item-${suffix}`;
  const secret = Buffer.from('synthetic-bridge-secret-material-32bytes!');
  const trustedSecrets = new Map<string, Uint8Array>([[secretReference, secret]]);
  const capabilityPolicyHash = 'a'.repeat(64);
  const trustedArtifactContent = new Map<string, string>();
  let workspaceId: string;
  let otherWorkspaceId: string;
  let capability: OperationalEventCapability;
  let plannerCapability: OperationalEventCapability;
  let bridge: AcpBridgeAdmissionService;
  let costGovernance: AcpCostGovernanceService;
  let brokerReservations: AcpBrokerReservationService;
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
  let candidateSnapshot: TrustedBrokerCandidateSnapshot;
  const secretLeaseRequests: BridgeSecretLeaseRequest[] = [];

  function testSecretLease(
    resolve: (request: Readonly<BridgeSecretLeaseRequest>) => Promise<Uint8Array> = async (
      request,
    ) => {
      const resolved = trustedSecrets.get(request.secretReference);
      if (!resolved) throw new Error('synthetic source unavailable');
      return resolved;
    },
  ) {
    return new ScopedBridgeSecretLeaseResolver({
      async resolve(request) {
        secretLeaseRequests.push({ ...request });
        return resolve(request);
      },
    });
  }

  function testBridge(
    secretResolver: BridgeSecretLeaseResolver = testSecretLease(),
    brokerVerifier: { verify: AcpBrokerReservationService['verify'] } = brokerReservations,
    auditService: AuditService = new AuditService(),
    codexAuthorizations?: CodexRegistrationAuthorizationSource,
    codexCapabilityAuthorizations?: CodexCapabilityExchangeAuthorizationSource,
    codexValidationDispatchAuthorizations?: CodexValidationDispatchAuthorizationSource,
  ) {
    return new AcpBridgeAdmissionService(
      auditService,
      secretResolver,
      brokerVerifier,
      {
        async verify(_workspace, _runtime, policyHash, codes) {
          return (
            policyHash === capabilityPolicyHash &&
            (codes.join(',') === 'health.read,quality.verify' ||
              (codes.length > 0 && codes.every((code) => code.startsWith('codex.catalog.'))))
          );
        },
      },
      {
        async verify(evidence) {
          return trustedArtifactContent.get(evidence.uriReference) === evidence.contentHash;
        },
      },
      {
        async allowsDeterministicFixture(requestWorkspaceId) {
          return requestWorkspaceId === workspaceId;
        },
      },
      costGovernance,
      codexAuthorizations,
      codexCapabilityAuthorizations,
      codexValidationDispatchAuthorizations,
    );
  }

  function codexCandidate(
    candidateWorkspaceId: string,
    candidateSuffix: string,
    observed = new Date(),
    secretReference = `secret:codex-${candidateSuffix}`,
    expectedSecretDigest = 'd'.repeat(64),
  ) {
    const base = deterministicLinuxAdmission().manifest;
    const authenticatedAt = new Date(observed.getTime() - 1_000);
    const expiresAt = new Date(observed.getTime() + 4 * 60_000);
    return createCodexAuthenticatedRegistrationCandidate({
      manifest: validateCodexAppServerManifest({
        ...base,
        workspaceId: candidateWorkspaceId,
        runtimeId: `codex.runtime-${candidateSuffix}`,
        connectionId: `codex-connection-${candidateSuffix}`,
        manifestId: `codex-manifest-${candidateSuffix}`,
        adapterKind: CODEX_APP_SERVER_ADAPTER_KIND,
        testOnly: false,
        executable: {
          canonicalPath: '/opt/ventureos/runtimes/codex/codex',
          sha256: '8'.repeat(64),
          identityReference: `device-8:inode-${candidateSuffix}`,
        },
        argv: [...CODEX_APP_SERVER_ARGV],
        argumentPolicyReference: CODEX_APP_SERVER_ARGUMENT_POLICY,
        secretTransport: 'NONE',
      }),
      protocol: {
        state: 'INITIALIZED',
        threadId: null,
        turnId: null,
        terminalStatus: null,
        acceptedEvents: 0,
        acceptedBytes: 0,
        runtimeConnection: 'NOT_CONFIGURED',
      },
      bridge: {
        schemaVersion: 1,
        workspaceId: candidateWorkspaceId,
        runtimeId: `codex.runtime-${candidateSuffix}`,
        connectionId: `codex-connection-${candidateSuffix}`,
        sessionId: `codex-session-${candidateSuffix}`,
        principalReference: `principal:codex-${candidateSuffix}`,
        parentNonce: `parent-nonce-${candidateSuffix}`,
        runtimeNonce: `runtime-nonce-${candidateSuffix}`,
        secretReference,
        expectedSecretDigest,
        authGeneration: 1,
        authenticatedAt: authenticatedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
      account: {
        request: { method: 'account/read', id: 1, params: { refreshToken: false } },
        response: {
          id: 1,
          result: {
            account: { type: 'chatgpt', email: 'must-not-persist@example.com', planType: 'plus' },
            requiresOpenaiAuth: true,
          },
        },
        observedAt: observed.toISOString(),
      },
    });
  }

  function refreshCandidateSnapshot(overrides: Partial<RuntimeRoutingCandidate> = {}): void {
    const candidate: RuntimeRoutingCandidate = {
      runtimeId,
      connectionId,
      workspaceId,
      connectionStatus: 'CONNECTED',
      authenticatedPrincipalId: `fixture-principal-${suffix}`,
      trustEvidence: {
        registration: {
          verified: true,
          runtimeId,
          connectionId,
          principalId: `fixture-principal-${suffix}`,
        },
        capabilityExchange: {
          verified: true,
          runtimeId,
          connectionId,
          principalId: `fixture-principal-${suffix}`,
        },
        heartbeat: {
          verified: true,
          runtimeId,
          connectionId,
          principalId: `fixture-principal-${suffix}`,
          observedAt: new Date().toISOString(),
        },
        taskRoundTrip: {
          verified: true,
          runtimeId,
          connectionId,
          principalId: `fixture-principal-${suffix}`,
        },
      },
      capabilityIds: ['quality.verify'],
      toolGrants: [],
      maximumDataSensitivity: 'INTERNAL',
      securityTier: 2,
      reliabilityScoreBps: 9_000,
      qualityScoreBps: 9_000,
      expectedLatencyMs: 50,
      estimatedCostMinorUnits: 1,
      activeRuns: 0,
      maxConcurrentRuns: 10,
      remainingBudgetMinorUnits: 10_000,
      remainingComputeUnits: 10_000,
      ...overrides,
    };
    candidateSnapshot = {
      evidenceId: `fixture-candidates-${suffix}`,
      evidenceHash: sha256Canonical([candidate]),
      testOnly: true,
      candidates: [candidate],
    };
  }

  const trustedAgentReader: TrustedBrokerAgentReader = {
    async read(requestWorkspaceId, requestedRunId, requestedAgentId) {
      return {
        evidenceId: `agent-evidence:${requestedRunId}:${requestedAgentId}`,
        evidenceHash: sha256Canonical({
          schemaVersion: 1,
          workspaceId: requestWorkspaceId,
          runId: requestedRunId,
          agentId: requestedAgentId,
          testOnly: true,
        }),
        workspaceId: requestWorkspaceId,
        runId: requestedRunId,
        agentId: requestedAgentId,
        testOnly: true,
      };
    },
  };

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
    plannerCapability = OperationalEventCapability.issue('AI_COO', [
      { workspaceId, principalId, actorKind: 'AGENT', authorityLevel: 1 },
    ]);
    refreshCandidateSnapshot();
    brokerReservations = new AcpBrokerReservationService(
      new AuditService(),
      {
        async read() {
          return candidateSnapshot;
        },
      },
      trustedAgentReader,
      {
        async allowsDeterministicFixture(requestWorkspaceId) {
          return requestWorkspaceId === workspaceId;
        },
      },
    );
    costGovernance = new AcpCostGovernanceService(new AuditService());
    bridge = testBridge();
    taskRuns = new AcpTaskRunService(new AuditService(), bridge, bridge);
  });

  afterAll(async () => {
    if (workspaceId)
      await prisma.workspace.deleteMany({ where: { id: { in: [workspaceId, otherWorkspaceId] } } });
  });

  it('keeps Codex durable registration unavailable with the production-style deny source', async () => {
    const registrationSuffix = `denied-${suffix}`;
    const deniedSecretReference = `vault-codex-${registrationSuffix}`;
    const deniedSecret = new Uint8Array(32).fill(7);
    trustedSecrets.set(deniedSecretReference, deniedSecret);
    const candidate = codexCandidate(
      workspaceId,
      registrationSuffix,
      new Date(Date.now() - 5_000),
      deniedSecretReference,
      digestSecretReference(deniedSecret),
    );
    await expect(
      bridge.registerCodexRuntime(
        capability,
        { workspaceId, principalId },
        {
          candidate,
          environment: 'LOCAL_CONTROLLED',
          secretReference: deniedSecretReference,
          capabilityPolicyHash,
          idempotencyKey: `register-${registrationSuffix}`,
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    expect(
      await prisma.acpRuntime.findUnique({
        where: { workspaceId_id: { workspaceId, id: candidate.runtimeId } },
      }),
    ).toBeNull();
  });

  it('persists only normalized, authorized Codex registration evidence without promoting truth', async () => {
    const registrationSuffix = `authorized-${suffix}`;
    const observedAt = new Date(Date.now() - 5_000);
    const codexSecretReference = `vault-codex-${registrationSuffix}`;
    const codexSecret = new Uint8Array(32).fill(6);
    trustedSecrets.set(codexSecretReference, codexSecret);
    const candidate = codexCandidate(
      workspaceId,
      registrationSuffix,
      observedAt,
      codexSecretReference,
      digestSecretReference(codexSecret),
    );
    let authorizationId = '';
    const registrationAuthorizations = new Map<
      string,
      { authorizationId: string; issuedAt: Date }
    >();
    const requests: Readonly<CodexRegistrationAuthorizationRequest>[] = [];
    const capabilityObservedAt = new Date(observedAt.getTime() + 2_000);
    let capabilityAuthorizationId = '';
    const capabilityAuthorizations = new Map<string, { authorizationId: string; issuedAt: Date }>();
    const capabilityRequests: Readonly<CodexCapabilityExchangeAuthorizationRequest>[] = [];
    const validationDispatchRequests: Readonly<CodexValidationDispatchAuthorizationRequest>[] = [];
    const validationAuthorizationIssuedAtByRequest = new Map<string, Date>();
    const authorizedBridge = testBridge(
      undefined,
      undefined,
      undefined,
      {
        async read(request) {
          requests.push(request);
          const requestHash = codexRegistrationAuthorizationRequestHash(request);
          const decision = registrationAuthorizations.get(requestHash) ?? {
            authorizationId: `authorization-${requestHash.slice(0, 32)}`,
            issuedAt: new Date(),
          };
          registrationAuthorizations.set(requestHash, decision);
          authorizationId ||= decision.authorizationId;
          return {
            schemaVersion: 1,
            authorizationId: decision.authorizationId,
            requestHash,
            authorizedByReference: 'control-plane:codex-registration-policy-v1',
            issuedAt: decision.issuedAt.toISOString(),
            expiresAt: new Date(decision.issuedAt.getTime() + 4 * 60_000).toISOString(),
          };
        },
      },
      {
        async read(request) {
          capabilityRequests.push(request);
          const requestHash = codexCapabilityExchangeAuthorizationRequestHash(request);
          const decision = capabilityAuthorizations.get(requestHash) ?? {
            authorizationId: `capability-authorization-${requestHash.slice(0, 32)}`,
            issuedAt: new Date(),
          };
          capabilityAuthorizations.set(requestHash, decision);
          capabilityAuthorizationId ||= decision.authorizationId;
          return {
            schemaVersion: 1,
            authorizationId: decision.authorizationId,
            requestHash,
            authorizedByReference: 'control-plane:codex-capability-policy-v1',
            issuedAt: decision.issuedAt.toISOString(),
            expiresAt: new Date(decision.issuedAt.getTime() + 4 * 60_000).toISOString(),
          };
        },
      },
      {
        async read(request) {
          validationDispatchRequests.push(request);
          const requestHash = codexValidationDispatchAuthorizationRequestHash(request);
          const validationAuthorizationIssuedAt =
            validationAuthorizationIssuedAtByRequest.get(requestHash) ?? new Date();
          validationAuthorizationIssuedAtByRequest.set(
            requestHash,
            validationAuthorizationIssuedAt,
          );
          return {
            schemaVersion: 1,
            authorizationId: `validation-authorization-${requestHash.slice(0, 32)}`,
            requestHash,
            authorizedByReference: 'control-plane:codex-validation-policy-v1',
            issuedAt: validationAuthorizationIssuedAt.toISOString(),
            expiresAt: new Date(
              validationAuthorizationIssuedAt.getTime() + 4 * 60_000,
            ).toISOString(),
          };
        },
      },
    );
    const input = {
      candidate,
      environment: 'LOCAL_CONTROLLED',
      secretReference: codexSecretReference,
      capabilityPolicyHash,
      idempotencyKey: `register-${registrationSuffix}`,
    };
    const registered = await authorizedBridge.registerCodexRuntime(
      capability,
      { workspaceId, principalId },
      input,
    );
    expect(registered.replayed).toBe(false);
    expect(registered.runtime).toMatchObject({
      adapterKind: CODEX_APP_SERVER_ADAPTER_KIND,
      status: 'NOT_CONFIGURED',
    });
    expect(registered.connection).toMatchObject({
      status: 'NOT_CONFIGURED',
      authGeneration: 1,
    });
    expect(registered.evidence).toMatchObject({
      registrationCandidateHash: candidate.registrationCandidateHash,
      accountAuthMode: 'CHATGPT',
      authorizationId,
    });
    expect(JSON.stringify(registered.evidence)).not.toMatch(
      /must-not-persist@example\.com|plus|accessToken|apiKey/u,
    );
    const registrationAudit = await prisma.auditEvent.findFirstOrThrow({
      where: {
        workspaceReference: workspaceId,
        source: 'CONTROL_PLANE',
        entityType: 'AcpRuntimeRegistrationEvidence',
        entityId: candidate.registrationCandidateHash,
      },
    });
    expect(registrationAudit.after).toEqual({
      status: 'NOT_CONFIGURED',
      runtimeId: candidate.runtimeId,
    });
    expect(
      (await authorizedBridge.registerCodexRuntime(capability, { workspaceId, principalId }, input))
        .replayed,
    ).toBe(true);
    expect(requests).toHaveLength(2);

    const capabilityCandidate = createCodexCapabilityExchangeCandidate({
      registration: candidate,
      exchange: {
        request: { method: 'model/list', id: 42, params: { limit: 20, includeHidden: false } },
        response: {
          id: 42,
          result: {
            data: [
              {
                id: 'gpt-5.6-sol',
                model: 'gpt-5.6-sol',
                displayName: 'GPT 5.6 Sol',
                hidden: false,
                defaultReasoningEffort: 'low',
                supportedReasoningEfforts: [
                  { reasoningEffort: 'low', description: 'Fast' },
                  { reasoningEffort: 'high', description: 'Thorough' },
                ],
                inputModalities: ['text', 'image'],
                supportsPersonality: true,
                isDefault: true,
              },
            ],
            nextCursor: null,
          },
        },
        observedAt: capabilityObservedAt.toISOString(),
      },
    });
    const capabilityInput = {
      candidate: capabilityCandidate,
      capabilityPolicyHash,
      idempotencyKey: `capability-${registrationSuffix}`,
    };
    await expect(
      bridge.acceptCodexCapabilityExchange(
        capability,
        { workspaceId, principalId },
        capabilityInput,
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    const acceptedCapability = await authorizedBridge.acceptCodexCapabilityExchange(
      capability,
      { workspaceId, principalId },
      capabilityInput,
    );
    expect(acceptedCapability.replayed).toBe(false);
    expect(acceptedCapability.runtime.status).toBe('NOT_CONFIGURED');
    expect(acceptedCapability.connection).toMatchObject({
      status: 'NOT_CONFIGURED',
      capabilityCodes: [],
      capabilityDigest: null,
    });
    expect(acceptedCapability.evidence).toMatchObject({
      capabilityCandidateHash: capabilityCandidate.capabilityCandidateHash,
      registrationCandidateHash: candidate.registrationCandidateHash,
      capabilityCodes: capabilityCandidate.capabilityCodes,
      authorizationId: capabilityAuthorizationId,
    });
    expect(JSON.stringify(acceptedCapability.evidence)).not.toMatch(
      /gpt-5\.6-sol|GPT 5\.6 Sol|Fast|Thorough|accessToken|apiKey/u,
    );
    const [durableCapability] = await prisma.$queryRaw<
      Array<{
        capabilityCandidateHash: string;
        capabilityCodes: string[];
        authorizationId: string;
      }>
    >(Prisma.sql`
      SELECT "capabilityCandidateHash", "capabilityCodes", "authorizationId"
      FROM "acp_runtime_capability_evidence"
      WHERE "workspaceId" = CAST(${workspaceId} AS uuid)
        AND "capabilityCandidateHash" = ${capabilityCandidate.capabilityCandidateHash}
    `);
    expect(durableCapability).toEqual({
      capabilityCandidateHash: capabilityCandidate.capabilityCandidateHash,
      capabilityCodes: capabilityCandidate.capabilityCodes,
      authorizationId: capabilityAuthorizationId,
    });
    const capabilityAudit = await prisma.auditEvent.findFirstOrThrow({
      where: {
        workspaceReference: workspaceId,
        source: 'CONTROL_PLANE',
        entityType: 'AcpRuntimeCapabilityEvidence',
        entityId: capabilityCandidate.capabilityCandidateHash,
      },
    });
    expect(capabilityAudit.after).toEqual({
      status: 'NOT_CONFIGURED',
      runtimeId: candidate.runtimeId,
    });
    expect(
      (
        await authorizedBridge.acceptCodexCapabilityExchange(
          capability,
          { workspaceId, principalId },
          capabilityInput,
        )
      ).replayed,
    ).toBe(true);
    expect(capabilityRequests).toHaveLength(2);
    await expect(
      authorizedBridge.acceptCodexCapabilityExchange(
        capability,
        { workspaceId, principalId },
        { ...capabilityInput, idempotencyKey: `capability-drift-${registrationSuffix}` },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionConflictError);

    const heartbeatContext = {
      schemaVersion: 1 as const,
      workspaceId,
      runtimeId: candidate.runtimeId,
      connectionId: candidate.connectionId,
      sessionId: candidate.sessionId,
      principalReference: candidate.principalReference,
      parentNonce: `parent-nonce-${registrationSuffix}`,
      runtimeNonce: `runtime-nonce-${registrationSuffix}`,
      secretReference: codexSecretReference,
      expectedSecretDigest: digestSecretReference(codexSecret),
      authGeneration: 1,
      authenticatedAt: new Date(observedAt.getTime() - 1_000).toISOString(),
      expiresAt: new Date(observedAt.getTime() + 4 * 60_000).toISOString(),
    };
    const heartbeatPayload = { health: 'HEALTHY' };
    const heartbeatIssuedAt = new Date();
    const heartbeatEnvelope = signBridgeEnvelope(
      {
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        workspaceId,
        runtimeId: candidate.runtimeId,
        connectionId: candidate.connectionId,
        sessionId: candidate.sessionId,
        principalReference: candidate.principalReference,
        sequence: 1,
        messageId: `heartbeat-${registrationSuffix}`,
        type: 'HEARTBEAT',
        issuedAt: heartbeatIssuedAt.toISOString(),
        expiresAt: new Date(heartbeatIssuedAt.getTime() + 60_000).toISOString(),
        payloadDigest: digestBridgePayload(heartbeatPayload),
        payload: heartbeatPayload,
      },
      deriveBridgeKeys(codexSecret, heartbeatContext).runtimeToParent,
    );
    const heartbeatInput = {
      registration: candidate,
      capability: capabilityCandidate,
      bridge: heartbeatContext,
      envelope: heartbeatEnvelope,
      idempotencyKey: `heartbeat-${registrationSuffix}`,
    };
    const acceptedHeartbeat = await authorizedBridge.acceptCodexHeartbeatEvidence(
      capability,
      { workspaceId, principalId },
      heartbeatInput,
    );
    expect(acceptedHeartbeat.replayed).toBe(false);
    expect(acceptedHeartbeat.runtime.status).toBe('NOT_CONFIGURED');
    expect(acceptedHeartbeat.connection).toMatchObject({
      status: 'NOT_CONFIGURED',
      capabilityCodes: [],
      capabilityDigest: null,
      lastHeartbeatAt: null,
      lastHeartbeatHealth: null,
      lastHeartbeatSequence: null,
    });
    expect(acceptedHeartbeat.evidence).toMatchObject({
      registrationCandidateHash: candidate.registrationCandidateHash,
      capabilityCandidateHash: capabilityCandidate.capabilityCandidateHash,
      messageId: heartbeatEnvelope.messageId,
      health: 'HEALTHY',
      sequence: 1,
    });
    expect(JSON.stringify(acceptedHeartbeat.evidence)).not.toContain(heartbeatEnvelope.mac);
    expect(secretLeaseRequests.at(-1)?.purpose).toBe('VERIFY_FRAME');
    const heartbeatAudit = await prisma.auditEvent.findFirstOrThrow({
      where: {
        workspaceReference: workspaceId,
        source: 'CONTROL_PLANE',
        entityType: 'AcpRuntimeHeartbeatEvidence',
        entityId: acceptedHeartbeat.evidence.heartbeatCandidateHash,
      },
    });
    expect(heartbeatAudit.after).toEqual({
      connectionId: candidate.connectionId,
      health: 'HEALTHY',
      sequence: 1,
    });
    expect(
      (
        await authorizedBridge.acceptCodexHeartbeatEvidence(
          capability,
          { workspaceId, principalId },
          heartbeatInput,
        )
      ).replayed,
    ).toBe(true);
    await expect(
      authorizedBridge.acceptCodexHeartbeatEvidence(
        capability,
        { workspaceId, principalId },
        { ...heartbeatInput, idempotencyKey: `heartbeat-drift-${registrationSuffix}` },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionConflictError);
    await expect(
      authorizedBridge.acceptCodexHeartbeatEvidence(
        capability,
        { workspaceId, principalId },
        {
          ...heartbeatInput,
          envelope: { ...heartbeatEnvelope, mac: 'A'.repeat(43) },
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    await expect(
      prisma.$executeRaw(Prisma.sql`
        UPDATE "acp_runtime_heartbeat_evidence"
        SET "health" = 'DEGRADED'
        WHERE "workspaceId" = CAST(${workspaceId} AS uuid)
          AND "heartbeatCandidateHash" = ${acceptedHeartbeat.evidence.heartbeatCandidateHash}
      `),
    ).rejects.toThrow();

    const validationPlan: DurableObjectivePlanInput = {
      workspaceId,
      idempotencyKey: `codex-validation-plan-${registrationSuffix}`,
      policyVersion: 'codex-validation-v1',
      objective: {
        id: `codex-validation-objective-${registrationSuffix}`,
        title: 'Validate Codex runtime round trip',
        desiredOutcome: 'Retain a bounded authenticated runtime result',
        maximumAuthority: 3,
        costLimit: { currency: 'EUR', maximumMinorUnits: 0, maximumComputeUnits: 10 },
        acceptanceCriteria: ['authenticated-result'],
        verificationCriteria: ['exact-correlation'],
        stopConditions: ['policy-denial'],
      },
      projects: [
        {
          id: `codex-validation-project-${registrationSuffix}`,
          title: 'Codex runtime validation',
        },
      ],
      tasks: [
        {
          id: `codex-validation-task-${registrationSuffix}`,
          projectId: `codex-validation-project-${registrationSuffix}`,
          title: 'Perform zero-spend runtime validation',
          kind: 'quality.verify',
          dependencyIds: [],
          requiredAuthority: 3,
          costLimit: { currency: 'EUR', maximumMinorUnits: 0, maximumComputeUnits: 10 },
          estimatedDurationMs: 30_000,
          acceptanceCriteria: ['authenticated-result'],
          verificationCriteria: ['exact-correlation'],
          stopConditions: ['policy-denial'],
          retryPolicy: {
            maximumAttempts: 1,
            retryableFailureCodes: ['TRANSIENT'],
            stopAfterFailureCodes: ['POLICY_DENIED'],
          },
          agentPolicy: {
            templateId: 'codex-runtime-validator',
            scopes: ['codex.runtime.round-trip.v1'],
          },
          routingPolicy: {
            capabilityId: 'codex.runtime.round-trip.v1',
            maximumLatencyMs: 30_000,
          },
        },
      ],
    };
    const validationObjective = await taskRuns.createPlan(
      plannerCapability,
      { workspaceId, principalId },
      validationPlan,
    );
    const validationTask = validationObjective.objective.tasks[0]!;
    const validationRun = validationTask.runs[0]!;
    const heartbeatCandidate = createCodexHeartbeatEvidenceCandidate({
      registration: candidate,
      capability: capabilityCandidate,
      bridge: heartbeatContext,
      envelope: heartbeatEnvelope,
    });
    const validationIssuedAt = new Date();
    const validationCandidate = createCodexValidationDispatchCandidate({
      heartbeat: heartbeatCandidate,
      dispatchId: `codex-validation-dispatch-${registrationSuffix}`,
      taskId: validationTask.id,
      runId: validationRun.id,
      agentId: `agent:codex-validator-${registrationSuffix}`,
      authorityLevel: 3,
      taskPolicyHash: validationRun.policyHash,
      maximumCostMinorUnits: 0,
      maximumComputeUnits: 10,
      maximumDurationMs: 30_000,
      issuedAt: validationIssuedAt.toISOString(),
      expiresAt: new Date(validationIssuedAt.getTime() + 30_000).toISOString(),
    });
    const validationInput = {
      candidate: validationCandidate,
      bridge: heartbeatContext,
      idempotencyKey: `codex-validation-dispatch-${registrationSuffix}`,
    };
    await expect(
      bridge.prepareCodexValidationDispatch(
        capability,
        { workspaceId, principalId },
        validationInput,
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    const preparedValidation = await authorizedBridge.prepareCodexValidationDispatch(
      capability,
      { workspaceId, principalId },
      validationInput,
    );
    expect(preparedValidation.replayed).toBe(false);
    expect(preparedValidation.runtime.status).toBe('NOT_CONFIGURED');
    expect(preparedValidation.connection.status).toBe('NOT_CONFIGURED');
    expect(preparedValidation.run).toMatchObject({
      status: 'PREPARED',
      assignedAgentId: null,
      assignedRuntimeId: null,
      assignedConnectionId: null,
    });
    expect(preparedValidation.evidence).toMatchObject({
      validationDispatchCandidateHash: validationCandidate.validationDispatchCandidateHash,
      heartbeatCandidateHash: heartbeatCandidate.heartbeatCandidateHash,
      dispatchId: validationCandidate.dispatchId,
      challengeCode: 'codex.runtime.round-trip.v1',
      maximumCostMinorUnits: 0,
      outboundSequence: 1,
    });
    expect(JSON.stringify(preparedValidation.evidence)).not.toContain(preparedValidation.frame.mac);
    expect(secretLeaseRequests.at(-1)?.purpose).toBe('SIGN_FRAME');
    expect(() =>
      verifyBridgeEnvelope(
        preparedValidation.frame,
        deriveBridgeKeys(codexSecret, heartbeatContext).parentToRuntime,
        heartbeatContext,
        validationIssuedAt,
      ),
    ).not.toThrow();
    expect(validationDispatchRequests).toHaveLength(1);
    expect(
      (
        await authorizedBridge.prepareCodexValidationDispatch(
          capability,
          { workspaceId, principalId },
          validationInput,
        )
      ).replayed,
    ).toBe(true);
    expect(validationDispatchRequests).toHaveLength(2);
    const validationHandoffInput = {
      attemptId: `codex-validation-egress-${registrationSuffix}`,
      validationDispatchCandidateHash: validationCandidate.validationDispatchCandidateHash,
      bridge: heartbeatContext,
      idempotencyKey: `codex-validation-egress-${registrationSuffix}`,
    };
    const claimedValidation = await authorizedBridge.claimCodexValidationEgressHandoff(
      capability,
      { workspaceId, principalId },
      validationHandoffInput,
    );
    expect(claimedValidation.replayed).toBe(false);
    expect(claimedValidation.attempt).toMatchObject({
      schemaVersion: 1,
      validationDispatchCandidateHash: validationCandidate.validationDispatchCandidateHash,
      heartbeatCandidateHash: heartbeatCandidate.heartbeatCandidateHash,
      generation: 1,
      state: 'CLAIMED',
      maximumCostMinorUnits: 0,
      outboundSequence: 1,
    });
    expect(claimedValidation.attempt.expiresAt.getTime()).toBeLessThanOrEqual(
      claimedValidation.attempt.claimedAt.getTime() + 15_000,
    );
    expect(claimedValidation.frame).toEqual(preparedValidation.frame);
    await expect(
      authorizedBridge.claimCodexValidationEgressHandoff(
        capability,
        { workspaceId, principalId },
        validationHandoffInput,
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    await expect(
      authorizedBridge.claimCodexValidationEgressHandoff(
        capability,
        { workspaceId, principalId },
        {
          ...validationHandoffInput,
          attemptId: `codex-validation-egress-other-${registrationSuffix}`,
          idempotencyKey: `codex-validation-egress-other-${registrationSuffix}`,
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionConflictError);
    await expect(
      prisma.$executeRaw(Prisma.sql`
        UPDATE "acp_codex_validation_egress_handoff_attempts"
        SET "state" = 'RELEASED'
        WHERE "workspaceId" = CAST(${workspaceId} AS uuid)
          AND "id" = ${validationHandoffInput.attemptId}
      `),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw(Prisma.sql`
        DELETE FROM "acp_codex_validation_egress_handoff_attempts"
        WHERE "workspaceId" = CAST(${workspaceId} AS uuid)
          AND "id" = ${validationHandoffInput.attemptId}
      `),
    ).rejects.toThrow();
    const statusIssuedAt = new Date(claimedValidation.attempt.claimedAt.getTime() + 1);
    const terminalIssuedAt = new Date(statusIssuedAt.getTime() + 1);
    const resultExpiresAt = new Date(
      Math.min(
        validationCandidate.expiresAt ? Date.parse(validationCandidate.expiresAt) : Infinity,
        terminalIssuedAt.getTime() + 5_000,
      ),
    );
    const terminalEvidence = {
      threadId: `codex-thread-${registrationSuffix}`,
      turnId: `codex-turn-${registrationSuffix}`,
      status: 'completed' as const,
      messageHash: 'b'.repeat(64),
      runtimeConnection: 'NOT_CONFIGURED' as const,
      progressEventCount: 3,
      progressEvidenceHash: '9'.repeat(64),
      tokenUsageEventCount: 1,
      tokenUsageEvidenceHash: '8'.repeat(64),
      usageAccountingState: 'OBSERVED_UNMAPPED' as const,
      recognizedCostMinorUnits: 0 as const,
      recognizedComputeUnits: 0 as const,
    };
    const runtimeKeys = deriveBridgeKeys(codexSecret, heartbeatContext);
    const statusEnvelope = signBridgeEnvelope(
      {
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        type: 'DISPATCH_ACCEPTED',
        workspaceId,
        runtimeId: heartbeatContext.runtimeId,
        connectionId: heartbeatContext.connectionId,
        sessionId: heartbeatContext.sessionId,
        principalReference: heartbeatContext.principalReference,
        sequence: 2,
        messageId: `codex-validation-status-${registrationSuffix}`,
        issuedAt: statusIssuedAt.toISOString(),
        expiresAt: resultExpiresAt.toISOString(),
        payload: {
          challengeCode: 'codex.runtime.round-trip.v1',
          dispatchId: validationCandidate.dispatchId,
          taskId: validationCandidate.taskId,
          runId: validationCandidate.runId,
        },
        payloadDigest: digestBridgePayload({
          challengeCode: 'codex.runtime.round-trip.v1',
          dispatchId: validationCandidate.dispatchId,
          taskId: validationCandidate.taskId,
          runId: validationCandidate.runId,
        }),
      },
      runtimeKeys.runtimeToParent,
    );
    const terminalPayload = {
      challengeCode: 'codex.runtime.round-trip.v1',
      dispatchId: validationCandidate.dispatchId,
      taskId: validationCandidate.taskId,
      runId: validationCandidate.runId,
      resultCode: 'VALIDATION_COMPLETED',
      terminalStatus: 'completed',
      terminalThreadId: terminalEvidence.threadId,
      terminalTurnId: terminalEvidence.turnId,
      terminalMessageHash: terminalEvidence.messageHash,
      progressEventCount: terminalEvidence.progressEventCount,
      progressEvidenceHash: terminalEvidence.progressEvidenceHash,
      tokenUsageEventCount: terminalEvidence.tokenUsageEventCount,
      tokenUsageEvidenceHash: terminalEvidence.tokenUsageEvidenceHash,
      usageAccountingState: terminalEvidence.usageAccountingState,
      recognizedCostMinorUnits: 0,
      recognizedComputeUnits: 0,
    };
    const terminalEnvelope = signBridgeEnvelope(
      {
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        type: 'RESULT',
        workspaceId,
        runtimeId: heartbeatContext.runtimeId,
        connectionId: heartbeatContext.connectionId,
        sessionId: heartbeatContext.sessionId,
        principalReference: heartbeatContext.principalReference,
        sequence: 3,
        messageId: `codex-validation-result-${registrationSuffix}`,
        issuedAt: terminalIssuedAt.toISOString(),
        expiresAt: resultExpiresAt.toISOString(),
        payload: terminalPayload,
        payloadDigest: digestBridgePayload(terminalPayload),
      },
      runtimeKeys.runtimeToParent,
    );
    runtimeKeys.parentToRuntime.fill(0);
    runtimeKeys.runtimeToParent.fill(0);
    const roundTripInput = {
      handoffAttemptId: validationHandoffInput.attemptId,
      dispatch: validationCandidate,
      bridge: heartbeatContext,
      terminal: terminalEvidence,
      statusEnvelope,
      terminalEnvelope,
      idempotencyKey: `codex-validation-round-trip-${registrationSuffix}`,
    };
    const processBinding = {
      schemaVersion: 1 as const,
      supervisionId: `codex-supervision-${registrationSuffix}`,
      launchNonce: `codex-launch-${registrationSuffix}`,
      workspaceId,
      runtimeId: validationCandidate.runtimeId,
      connectionId: validationCandidate.connectionId,
      platform: 'LINUX' as const,
      manifestHash: '1'.repeat(64),
      admissionEvidenceHash: '2'.repeat(64),
      admissionBindingHash: '3'.repeat(64),
      testOnly: true,
    };
    const processClaimId = `codex-process-claim-${registrationSuffix}`;
    expect(() =>
      authorizedBridge.createCodexValidationProcessSessionAuthority(
        plannerCapability,
        { workspaceId, principalId },
        {
          claimId: processClaimId,
          handoffAttemptId: validationHandoffInput.attemptId,
          claimIdempotencyKey: processClaimId,
          completionIdempotencyKey: `codex-process-completion-${registrationSuffix}`,
        },
      ),
    ).toThrow(AcpBridgeAdmissionDeniedError);
    const processAuthority = authorizedBridge.createCodexValidationProcessSessionAuthority(
      capability,
      { workspaceId, principalId },
      {
        claimId: processClaimId,
        handoffAttemptId: validationHandoffInput.attemptId,
        claimIdempotencyKey: processClaimId,
        completionIdempotencyKey: `codex-process-completion-${registrationSuffix}`,
      },
    );
    await processAuthority.claim({ binding: processBinding, dispatch: validationCandidate });
    const processClaim = await authorizedBridge.claimCodexValidationProcessSession(
      capability,
      { workspaceId, principalId },
      {
        claimId: processClaimId,
        handoffAttemptId: validationHandoffInput.attemptId,
        dispatch: validationCandidate,
        binding: processBinding,
        idempotencyKey: processClaimId,
      },
    );
    expect(processClaim.replayed).toBe(true);
    expect(processClaim.claim).toMatchObject({
      state: 'CLAIMED',
      runtimeConnection: 'NOT_CONFIGURED',
      supervisionId: processBinding.supervisionId,
    });
    await expect(
      authorizedBridge.claimCodexValidationProcessSession(
        capability,
        { workspaceId, principalId },
        {
          claimId: processClaimId,
          handoffAttemptId: validationHandoffInput.attemptId,
          dispatch: validationCandidate,
          binding: { ...processBinding, launchNonce: `drift-${registrationSuffix}` },
          idempotencyKey: processClaimId,
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionConflictError);
    await expect(
      authorizedBridge.acceptCodexValidationRoundTripEvidence(
        capability,
        { workspaceId, principalId },
        roundTripInput,
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    const processCloseRequest = {
      schemaVersion: 1 as const,
      binding: processBinding,
      dispatchId: validationCandidate.dispatchId,
      validationDispatchCandidateHash: validationCandidate.validationDispatchCandidateHash,
      sessionId: validationCandidate.sessionId,
      issuedAt: validationCandidate.issuedAt,
      expiresAt: validationCandidate.expiresAt,
      runtimeConnection: 'NOT_CONFIGURED' as const,
      reason: 'COMPLETED' as const,
    };
    const processClosedAt = new Date(processClaim.claim.claimedAt.getTime() + 1);
    const processCleanup = createCodexValidationProcessCleanupEvidence(
      {
        schemaVersion: 1,
        binding: processBinding,
        dispatchId: validationCandidate.dispatchId,
        validationDispatchCandidateHash: validationCandidate.validationDispatchCandidateHash,
        sessionId: validationCandidate.sessionId,
        processState: 'EXITED',
        exitCode: 0,
        signal: null,
        closedAt: processClosedAt.toISOString(),
        runtimeConnection: 'NOT_CONFIGURED',
      },
      processCloseRequest,
      processClosedAt,
    );
    await expect(
      processAuthority.complete({
        binding: { ...processBinding, launchNonce: `authority-drift-${registrationSuffix}` },
        dispatch: validationCandidate,
        cleanup: processCleanup,
      }),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    await processAuthority.complete({
      binding: processBinding,
      dispatch: validationCandidate,
      cleanup: processCleanup,
    });
    const processCompletion = await authorizedBridge.completeCodexValidationProcessSession(
      capability,
      { workspaceId, principalId },
      {
        claimId: processClaimId,
        dispatch: validationCandidate,
        cleanup: processCleanup,
        idempotencyKey: `codex-process-completion-${registrationSuffix}`,
      },
    );
    expect(processCompletion.replayed).toBe(true);
    expect(processCompletion.completion).toMatchObject({
      cleanupEvidenceHash: processCleanup.cleanupEvidenceHash,
      reason: 'COMPLETED',
      processState: 'EXITED',
      runtimeConnection: 'NOT_CONFIGURED',
    });
    await expect(
      authorizedBridge.completeCodexValidationProcessSession(
        capability,
        { workspaceId, principalId },
        {
          claimId: processClaimId,
          dispatch: validationCandidate,
          cleanup: { ...processCleanup, cleanupEvidenceHash: 'f'.repeat(64) },
          idempotencyKey: `codex-process-completion-${registrationSuffix}`,
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    const acceptedRoundTrip = await authorizedBridge.acceptCodexValidationRoundTripEvidence(
      capability,
      { workspaceId, principalId },
      roundTripInput,
    );
    expect(acceptedRoundTrip.replayed).toBe(false);
    expect(acceptedRoundTrip.runtime.status).toBe('NOT_CONFIGURED');
    expect(acceptedRoundTrip.connection.status).toBe('NOT_CONFIGURED');
    expect(acceptedRoundTrip.run).toMatchObject({
      status: 'PREPARED',
      assignedAgentId: null,
      assignedRuntimeId: null,
      assignedConnectionId: null,
    });
    expect(acceptedRoundTrip.evidence).toMatchObject({
      handoffAttemptId: validationHandoffInput.attemptId,
      validationDispatchCandidateHash: validationCandidate.validationDispatchCandidateHash,
      heartbeatCandidateHash: heartbeatCandidate.heartbeatCandidateHash,
      statusSequence: 2,
      terminalSequence: 3,
      resultCode: 'VALIDATION_COMPLETED',
      providerAccess: 'NOT_CONFIGURED',
      runtimeConnection: 'NOT_CONFIGURED',
      connectionTransition: 'NOT_APPLIED',
      maximumCostMinorUnits: 0,
      progressEventCount: 3,
      tokenUsageEventCount: 1,
      usageAccountingState: 'OBSERVED_UNMAPPED',
      recognizedCostMinorUnits: 0,
      recognizedComputeUnits: 0,
    });
    expect(
      await prisma.acpRunUsage.count({ where: { workspaceId, runId: validationCandidate.runId } }),
    ).toBe(0);
    expect(
      await prisma.acpCostLedgerEntry.count({
        where: { workspaceId, runId: validationCandidate.runId },
      }),
    ).toBe(0);
    expect(JSON.stringify(acceptedRoundTrip.evidence)).not.toContain(statusEnvelope.mac);
    expect(JSON.stringify(acceptedRoundTrip.evidence)).not.toContain(terminalEnvelope.mac);
    await expect(
      prisma.$executeRaw(Prisma.sql`
        UPDATE "acp_codex_validation_process_session_completions"
        SET "runtimeConnection" = 'CONNECTED'
        WHERE "workspaceId" = CAST(${workspaceId} AS uuid)
          AND "cleanupEvidenceHash" = ${processCleanup.cleanupEvidenceHash}
      `),
    ).rejects.toThrow();
    expect(secretLeaseRequests.at(-1)?.purpose).toBe('VERIFY_FRAME');
    expect(
      (
        await authorizedBridge.acceptCodexValidationRoundTripEvidence(
          capability,
          { workspaceId, principalId },
          roundTripInput,
        )
      ).replayed,
    ).toBe(true);
    await expect(
      authorizedBridge.acceptCodexValidationRoundTripEvidence(
        capability,
        { workspaceId, principalId },
        {
          ...roundTripInput,
          idempotencyKey: `codex-validation-round-trip-drift-${registrationSuffix}`,
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionConflictError);
    await expect(
      authorizedBridge.acceptCodexValidationRoundTripEvidence(
        capability,
        { workspaceId, principalId },
        {
          ...roundTripInput,
          terminalEnvelope: {
            ...terminalEnvelope,
            payload: { ...terminalPayload, terminalMessageHash: 'c'.repeat(64) },
          },
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    await expect(
      prisma.$executeRaw(Prisma.sql`
        UPDATE "acp_codex_validation_round_trip_evidence"
        SET "connectionTransition" = 'APPLIED'
        WHERE "workspaceId" = CAST(${workspaceId} AS uuid)
          AND "roundTripCandidateHash" = ${acceptedRoundTrip.evidence.roundTripCandidateHash}
      `),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw(Prisma.sql`
        DELETE FROM "acp_codex_validation_round_trip_evidence"
        WHERE "workspaceId" = CAST(${workspaceId} AS uuid)
          AND "roundTripCandidateHash" = ${acceptedRoundTrip.evidence.roundTripCandidateHash}
      `),
    ).rejects.toThrow();

    const cancellationProjectId = `codex-cancellation-project-${registrationSuffix}`;
    const cancellationPlan: DurableObjectivePlanInput = {
      ...validationPlan,
      idempotencyKey: `codex-cancellation-plan-${registrationSuffix}`,
      objective: {
        ...validationPlan.objective,
        id: `codex-cancellation-objective-${registrationSuffix}`,
        title: 'Validate Codex runtime cancellation',
      },
      projects: [
        {
          ...validationPlan.projects[0]!,
          id: cancellationProjectId,
          title: 'Codex runtime cancellation',
        },
      ],
      tasks: [
        {
          ...validationPlan.tasks[0]!,
          id: `codex-cancellation-task-${registrationSuffix}`,
          projectId: cancellationProjectId,
          title: 'Perform zero-spend runtime cancellation',
        },
      ],
    };
    const cancellationObjective = await taskRuns.createPlan(
      plannerCapability,
      { workspaceId, principalId },
      cancellationPlan,
    );
    const cancellationTask = cancellationObjective.objective.tasks[0]!;
    const cancellationRun = cancellationTask.runs[0]!;
    const cancellationRuntimeSuffix = `${registrationSuffix}-cancellation`;
    const cancellationRuntimeObservedAt = new Date();
    const cancellationSecretReference = `vault-codex-${cancellationRuntimeSuffix}`;
    const cancellationSecret = new Uint8Array(32).fill(7);
    trustedSecrets.set(cancellationSecretReference, cancellationSecret);
    const cancellationRegistration = codexCandidate(
      workspaceId,
      cancellationRuntimeSuffix,
      cancellationRuntimeObservedAt,
      cancellationSecretReference,
      digestSecretReference(cancellationSecret),
    );
    const cancellationBridgeContext = {
      schemaVersion: 1 as const,
      workspaceId,
      runtimeId: cancellationRegistration.runtimeId,
      connectionId: cancellationRegistration.connectionId,
      sessionId: `codex-session-${cancellationRuntimeSuffix}`,
      principalReference: `principal:codex-${cancellationRuntimeSuffix}`,
      parentNonce: `parent-nonce-${cancellationRuntimeSuffix}`,
      runtimeNonce: `runtime-nonce-${cancellationRuntimeSuffix}`,
      secretReference: cancellationSecretReference,
      expectedSecretDigest: digestSecretReference(cancellationSecret),
      authGeneration: 1,
      authenticatedAt: new Date(cancellationRuntimeObservedAt.getTime() - 1_000).toISOString(),
      expiresAt: new Date(cancellationRuntimeObservedAt.getTime() + 4 * 60_000).toISOString(),
    };
    await authorizedBridge.registerCodexRuntime(
      capability,
      { workspaceId, principalId },
      {
        candidate: cancellationRegistration,
        environment: 'LOCAL_CONTROLLED',
        secretReference: cancellationSecretReference,
        capabilityPolicyHash,
        idempotencyKey: `register-${cancellationRuntimeSuffix}`,
      },
    );
    const cancellationCapability = createCodexCapabilityExchangeCandidate({
      registration: cancellationRegistration,
      exchange: {
        request: { method: 'model/list', id: 42, params: { limit: 20, includeHidden: false } },
        response: {
          id: 42,
          result: {
            data: [
              {
                id: 'gpt-5.6-sol',
                model: 'gpt-5.6-sol',
                displayName: 'GPT 5.6 Sol',
                hidden: false,
                defaultReasoningEffort: 'low',
                supportedReasoningEfforts: [
                  { reasoningEffort: 'low', description: 'Fast' },
                  { reasoningEffort: 'high', description: 'Thorough' },
                ],
                inputModalities: ['text', 'image'],
                supportsPersonality: true,
                isDefault: true,
              },
            ],
            nextCursor: null,
          },
        },
        observedAt: new Date().toISOString(),
      },
    });
    await authorizedBridge.acceptCodexCapabilityExchange(
      capability,
      { workspaceId, principalId },
      {
        candidate: cancellationCapability,
        capabilityPolicyHash,
        idempotencyKey: `capability-${cancellationRuntimeSuffix}`,
      },
    );
    const cancellationHeartbeatPayload = { health: 'HEALTHY' };
    const cancellationHeartbeatIssuedAt = new Date();
    const cancellationHeartbeatEnvelope = signBridgeEnvelope(
      {
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        workspaceId,
        runtimeId: cancellationBridgeContext.runtimeId,
        connectionId: cancellationBridgeContext.connectionId,
        sessionId: cancellationBridgeContext.sessionId,
        principalReference: cancellationBridgeContext.principalReference,
        sequence: 1,
        messageId: `heartbeat-${cancellationRuntimeSuffix}`,
        type: 'HEARTBEAT',
        issuedAt: cancellationHeartbeatIssuedAt.toISOString(),
        expiresAt: new Date(cancellationHeartbeatIssuedAt.getTime() + 60_000).toISOString(),
        payloadDigest: digestBridgePayload(cancellationHeartbeatPayload),
        payload: cancellationHeartbeatPayload,
      },
      deriveBridgeKeys(cancellationSecret, cancellationBridgeContext).runtimeToParent,
    );
    await authorizedBridge.acceptCodexHeartbeatEvidence(
      capability,
      { workspaceId, principalId },
      {
        registration: cancellationRegistration,
        capability: cancellationCapability,
        bridge: cancellationBridgeContext,
        envelope: cancellationHeartbeatEnvelope,
        idempotencyKey: `heartbeat-${cancellationRuntimeSuffix}`,
      },
    );
    const cancellationHeartbeatCandidate = createCodexHeartbeatEvidenceCandidate({
      registration: cancellationRegistration,
      capability: cancellationCapability,
      bridge: cancellationBridgeContext,
      envelope: cancellationHeartbeatEnvelope,
    });
    const cancellationDispatchAt = new Date();
    const cancellationDispatch = createCodexValidationDispatchCandidate({
      heartbeat: cancellationHeartbeatCandidate,
      dispatchId: `codex-cancellation-dispatch-${registrationSuffix}`,
      taskId: cancellationTask.id,
      runId: cancellationRun.id,
      agentId: `agent:codex-validator-cancel-${registrationSuffix}`,
      authorityLevel: 3,
      taskPolicyHash: cancellationRun.policyHash,
      maximumCostMinorUnits: 0,
      maximumComputeUnits: 10,
      maximumDurationMs: 30_000,
      issuedAt: cancellationDispatchAt.toISOString(),
      expiresAt: new Date(cancellationDispatchAt.getTime() + 30_000).toISOString(),
    });
    const preparedCancellation = await authorizedBridge.prepareCodexValidationDispatch(
      capability,
      { workspaceId, principalId },
      {
        candidate: cancellationDispatch,
        bridge: cancellationBridgeContext,
        idempotencyKey: `codex-cancellation-dispatch-${registrationSuffix}`,
      },
    );
    const cancellationHandoffId = `codex-cancellation-egress-${registrationSuffix}`;
    const claimedCancellation = await authorizedBridge.claimCodexValidationEgressHandoff(
      capability,
      { workspaceId, principalId },
      {
        attemptId: cancellationHandoffId,
        validationDispatchCandidateHash: cancellationDispatch.validationDispatchCandidateHash,
        bridge: cancellationBridgeContext,
        idempotencyKey: cancellationHandoffId,
      },
    );
    expect(claimedCancellation.frame).toEqual(preparedCancellation.frame);
    const cancellationIssuedAt = new Date(claimedCancellation.attempt.claimedAt.getTime() + 1);
    const cancellationExpiresAt = new Date(
      Math.min(Date.parse(cancellationDispatch.expiresAt), cancellationIssuedAt.getTime() + 5_000),
    );
    const cancellationTerminal = {
      threadId: `codex-cancellation-thread-${registrationSuffix}`,
      turnId: `codex-cancellation-turn-${registrationSuffix}`,
      status: 'interrupted' as const,
      messageHash: 'd'.repeat(64),
      interruptRequestId: 4,
      interruptResponseHash: 'c'.repeat(64),
      runtimeConnection: 'NOT_CONFIGURED' as const,
      progressEventCount: 1,
      progressEvidenceHash: '7'.repeat(64),
      tokenUsageEventCount: 0,
      tokenUsageEvidenceHash: '95c9cbcf9d54ee66ed622c5c6dc41d45949a816164405da6219991a9b3dde532',
      usageAccountingState: 'NOT_OBSERVED' as const,
      recognizedCostMinorUnits: 0 as const,
      recognizedComputeUnits: 0 as const,
    };
    const cancellationPayload = {
      challengeCode: 'codex.runtime.round-trip.v1',
      dispatchId: cancellationDispatch.dispatchId,
      taskId: cancellationDispatch.taskId,
      runId: cancellationDispatch.runId,
      resultCode: 'VALIDATION_CANCELLED',
      interruptRequestId: cancellationTerminal.interruptRequestId,
      interruptResponseHash: cancellationTerminal.interruptResponseHash,
      terminalStatus: 'interrupted',
      terminalThreadId: cancellationTerminal.threadId,
      terminalTurnId: cancellationTerminal.turnId,
      terminalMessageHash: cancellationTerminal.messageHash,
      progressEventCount: cancellationTerminal.progressEventCount,
      progressEvidenceHash: cancellationTerminal.progressEvidenceHash,
      tokenUsageEventCount: cancellationTerminal.tokenUsageEventCount,
      tokenUsageEvidenceHash: cancellationTerminal.tokenUsageEvidenceHash,
      usageAccountingState: cancellationTerminal.usageAccountingState,
      recognizedCostMinorUnits: 0,
      recognizedComputeUnits: 0,
    };
    const cancellationKeys = deriveBridgeKeys(cancellationSecret, cancellationBridgeContext);
    const cancellationEnvelope = signBridgeEnvelope(
      {
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        type: 'CANCELLED',
        workspaceId,
        runtimeId: cancellationBridgeContext.runtimeId,
        connectionId: cancellationBridgeContext.connectionId,
        sessionId: cancellationBridgeContext.sessionId,
        principalReference: cancellationBridgeContext.principalReference,
        sequence: 2,
        messageId: `codex-validation-cancelled-${registrationSuffix}`,
        issuedAt: cancellationIssuedAt.toISOString(),
        expiresAt: cancellationExpiresAt.toISOString(),
        payload: cancellationPayload,
        payloadDigest: digestBridgePayload(cancellationPayload),
      },
      cancellationKeys.runtimeToParent,
    );
    cancellationKeys.parentToRuntime.fill(0);
    cancellationKeys.runtimeToParent.fill(0);
    const cancellationInput = {
      handoffAttemptId: cancellationHandoffId,
      dispatch: cancellationDispatch,
      bridge: cancellationBridgeContext,
      terminal: cancellationTerminal,
      cancellationEnvelope,
      idempotencyKey: `codex-validation-cancellation-${registrationSuffix}`,
    };
    const cancellationProcessBinding = {
      schemaVersion: 1 as const,
      supervisionId: `codex-cancellation-supervision-${registrationSuffix}`,
      launchNonce: `codex-cancellation-launch-${registrationSuffix}`,
      workspaceId,
      runtimeId: cancellationDispatch.runtimeId,
      connectionId: cancellationDispatch.connectionId,
      platform: 'LINUX' as const,
      manifestHash: '4'.repeat(64),
      admissionEvidenceHash: '5'.repeat(64),
      admissionBindingHash: '6'.repeat(64),
      testOnly: true,
    };
    const cancellationProcessClaimId = `codex-cancellation-process-${registrationSuffix}`;
    const cancellationProcessClaim = await authorizedBridge.claimCodexValidationProcessSession(
      capability,
      { workspaceId, principalId },
      {
        claimId: cancellationProcessClaimId,
        handoffAttemptId: cancellationHandoffId,
        dispatch: cancellationDispatch,
        binding: cancellationProcessBinding,
        idempotencyKey: cancellationProcessClaimId,
      },
    );
    await expect(
      authorizedBridge.acceptCodexValidationCancellationEvidence(
        capability,
        { workspaceId, principalId },
        cancellationInput,
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    const cancellationProcessClosedAt = new Date(
      cancellationProcessClaim.claim.claimedAt.getTime() + 1,
    );
    const cancellationProcessCleanup = createCodexValidationProcessCleanupEvidence(
      {
        schemaVersion: 1,
        binding: cancellationProcessBinding,
        dispatchId: cancellationDispatch.dispatchId,
        validationDispatchCandidateHash: cancellationDispatch.validationDispatchCandidateHash,
        sessionId: cancellationDispatch.sessionId,
        processState: 'EXITED',
        exitCode: null,
        signal: 'SIGTERM',
        closedAt: cancellationProcessClosedAt.toISOString(),
        runtimeConnection: 'NOT_CONFIGURED',
      },
      {
        schemaVersion: 1,
        binding: cancellationProcessBinding,
        dispatchId: cancellationDispatch.dispatchId,
        validationDispatchCandidateHash: cancellationDispatch.validationDispatchCandidateHash,
        sessionId: cancellationDispatch.sessionId,
        issuedAt: cancellationDispatch.issuedAt,
        expiresAt: cancellationDispatch.expiresAt,
        runtimeConnection: 'NOT_CONFIGURED',
        reason: 'CANCELLED',
      },
      cancellationProcessClosedAt,
    );
    await authorizedBridge.completeCodexValidationProcessSession(
      capability,
      { workspaceId, principalId },
      {
        claimId: cancellationProcessClaimId,
        dispatch: cancellationDispatch,
        cleanup: cancellationProcessCleanup,
        idempotencyKey: `codex-cancellation-process-complete-${registrationSuffix}`,
      },
    );
    const acceptedCancellation = await authorizedBridge.acceptCodexValidationCancellationEvidence(
      capability,
      { workspaceId, principalId },
      cancellationInput,
    );
    expect(acceptedCancellation.replayed).toBe(false);
    expect(acceptedCancellation.runtime.status).toBe('NOT_CONFIGURED');
    expect(acceptedCancellation.connection.status).toBe('NOT_CONFIGURED');
    expect(acceptedCancellation.run).toMatchObject({
      status: 'PREPARED',
      assignedAgentId: null,
      assignedRuntimeId: null,
      assignedConnectionId: null,
    });
    expect(acceptedCancellation.evidence).toMatchObject({
      handoffAttemptId: cancellationHandoffId,
      validationDispatchCandidateHash: cancellationDispatch.validationDispatchCandidateHash,
      cancellationSequence: 2,
      interruptRequestId: 4,
      interruptResponseHash: cancellationTerminal.interruptResponseHash,
      resultCode: 'VALIDATION_CANCELLED',
      terminalState: 'INTERRUPTED',
      providerAccess: 'NOT_CONFIGURED',
      runtimeConnection: 'NOT_CONFIGURED',
      connectionTransition: 'NOT_APPLIED',
      maximumCostMinorUnits: 0,
      progressEventCount: 1,
      tokenUsageEventCount: 0,
      usageAccountingState: 'NOT_OBSERVED',
      recognizedCostMinorUnits: 0,
      recognizedComputeUnits: 0,
    });
    expect(
      await prisma.acpRunUsage.count({ where: { workspaceId, runId: cancellationDispatch.runId } }),
    ).toBe(0);
    expect(
      await prisma.acpCostLedgerEntry.count({
        where: { workspaceId, runId: cancellationDispatch.runId },
      }),
    ).toBe(0);
    expect(JSON.stringify(acceptedCancellation.evidence)).not.toContain(cancellationEnvelope.mac);
    await expect(
      prisma.$executeRaw(Prisma.sql`
        INSERT INTO "acp_codex_validation_round_trip_evidence"
        SELECT (
          jsonb_populate_record(
            NULL::"acp_codex_validation_round_trip_evidence",
            to_jsonb(existing_evidence) || jsonb_build_object(
              'roundTripCandidateHash', ${'f'.repeat(64)},
              'sessionId', ${cancellationBridgeContext.sessionId},
              'statusMessageId', ${cancellationEnvelope.messageId},
              'terminalMessageId', ${`codex-validation-terminal-collision-${registrationSuffix}`},
              'roundTripIdempotencyKey', ${`codex-validation-round-trip-collision-${registrationSuffix}`}
            )
          )
        ).*
        FROM "acp_codex_validation_round_trip_evidence" existing_evidence
        WHERE "workspaceId" = CAST(${workspaceId} AS uuid)
          AND "roundTripCandidateHash" = ${acceptedRoundTrip.evidence.roundTripCandidateHash}
      `),
    ).rejects.toThrow();
    expect(
      (
        await authorizedBridge.acceptCodexValidationCancellationEvidence(
          capability,
          { workspaceId, principalId },
          cancellationInput,
        )
      ).replayed,
    ).toBe(true);
    await expect(
      authorizedBridge.acceptCodexValidationCancellationEvidence(
        capability,
        { workspaceId, principalId },
        {
          ...cancellationInput,
          idempotencyKey: `codex-validation-cancellation-drift-${registrationSuffix}`,
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionConflictError);
    await expect(
      authorizedBridge.acceptCodexValidationCancellationEvidence(
        capability,
        { workspaceId, principalId },
        {
          ...cancellationInput,
          cancellationEnvelope: {
            ...cancellationEnvelope,
            payload: { ...cancellationPayload, interruptResponseHash: 'e'.repeat(64) },
          },
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    await expect(
      prisma.$executeRaw(Prisma.sql`
        UPDATE "acp_codex_validation_cancellation_evidence"
        SET "connectionTransition" = 'APPLIED'
        WHERE "workspaceId" = CAST(${workspaceId} AS uuid)
          AND "cancellationCandidateHash" = ${acceptedCancellation.evidence.cancellationCandidateHash}
      `),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw(Prisma.sql`
        DELETE FROM "acp_codex_validation_cancellation_evidence"
        WHERE "workspaceId" = CAST(${workspaceId} AS uuid)
          AND "cancellationCandidateHash" = ${acceptedCancellation.evidence.cancellationCandidateHash}
      `),
    ).rejects.toThrow();
    await expect(
      authorizedBridge.prepareCodexValidationDispatch(
        capability,
        { workspaceId, principalId },
        { ...validationInput, idempotencyKey: `validation-drift-${registrationSuffix}` },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionConflictError);
    await expect(
      authorizedBridge.prepareCodexValidationDispatch(
        capability,
        { workspaceId, principalId },
        {
          ...validationInput,
          bridge: { ...heartbeatContext, runtimeNonce: 'runtime-nonce-drifted' },
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    await expect(
      prisma.$executeRaw(Prisma.sql`
        UPDATE "acp_codex_validation_dispatch_evidence"
        SET "maximumComputeUnits" = 11
        WHERE "workspaceId" = CAST(${workspaceId} AS uuid)
          AND "validationDispatchCandidateHash" = ${validationCandidate.validationDispatchCandidateHash}
      `),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw(Prisma.sql`
        UPDATE "acp_runtime_capability_evidence"
        SET "modelCount" = 2
        WHERE "workspaceId" = CAST(${workspaceId} AS uuid)
          AND "capabilityCandidateHash" = ${capabilityCandidate.capabilityCandidateHash}
      `),
    ).rejects.toThrow();
    await expect(
      authorizedBridge.acceptCodexCapabilityExchange(
        capability,
        { workspaceId, principalId },
        { ...capabilityInput, capabilityPolicyHash: 'b'.repeat(64) },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);

    const mismatchedSecretReference = `vault-codex-mismatch-${suffix}`;
    trustedSecrets.set(mismatchedSecretReference, new Uint8Array(32).fill(5));
    await expect(
      authorizedBridge.registerCodexRuntime(
        capability,
        { workspaceId, principalId },
        {
          ...input,
          candidate: codexCandidate(
            workspaceId,
            `mismatch-${suffix}`,
            new Date(Date.now() - 5_000),
            codexSecretReference,
            digestSecretReference(codexSecret),
          ),
          secretReference: mismatchedSecretReference,
          idempotencyKey: `register-mismatch-${suffix}`,
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);

    const otherCandidate = codexCandidate(
      otherWorkspaceId,
      `tenant-${suffix}`,
      new Date(Date.now() - 5_000),
    );
    await expect(
      authorizedBridge.registerCodexRuntime(
        capability,
        { workspaceId, principalId },
        {
          ...input,
          candidate: otherCandidate,
          idempotencyKey: `register-tenant-${suffix}`,
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    const otherCapabilityCandidate = createCodexCapabilityExchangeCandidate({
      registration: otherCandidate,
      exchange: {
        request: { method: 'model/list', id: 7, params: { limit: 1, includeHidden: false } },
        response: {
          id: 7,
          result: {
            data: [
              {
                id: 'tenant-model',
                model: 'tenant-model',
                displayName: 'Tenant model',
                hidden: false,
                defaultReasoningEffort: 'low',
                supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Low' }],
                inputModalities: ['text'],
                supportsPersonality: false,
                isDefault: true,
              },
            ],
            nextCursor: null,
          },
        },
        observedAt: new Date(Date.now() - 2_000).toISOString(),
      },
    });
    await expect(
      authorizedBridge.acceptCodexCapabilityExchange(
        capability,
        { workspaceId, principalId },
        {
          candidate: otherCapabilityCandidate,
          capabilityPolicyHash,
          idempotencyKey: `capability-tenant-${suffix}`,
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
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
            retryableFailureCodes: ['TRANSIENT'],
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
            retryableFailureCodes: ['TRANSIENT'],
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
            retryableFailureCodes: ['TRANSIENT'],
            stopAfterFailureCodes: ['POLICY_DENIED'],
          },
          agentPolicy: { templateId: 'fixture-agent', scopes: ['quality.verify'] },
          routingPolicy: { capabilityId: 'quality.verify', maximumLatencyMs: 1_000 },
        },
      ],
    };
    const created = await taskRuns.createPlan(
      plannerCapability,
      { workspaceId, principalId },
      plan,
    );
    const createdTasks = new Map(created.objective.tasks.map((task) => [task.id, task]));
    taskId = `bridge-task-${suffix}`;
    runId = createdTasks.get(taskId)!.runs[0]!.id;
    level4TaskId = `bridge-level4-${suffix}`;
    level4RunId = createdTasks.get(level4TaskId)!.runs[0]!.id;
    cancelTaskId = `bridge-cancel-${suffix}`;
    cancelRunId = createdTasks.get(cancelTaskId)!.runs[0]!.id;
    const periodStart = new Date(Date.now() - 86_400_000);
    const periodEnd = new Date(Date.now() + 86_400_000);
    const workspacePolicy = {
      schemaVersion: 1 as const,
      policyId: `workspace-cost-policy-${suffix}`,
      workspaceId,
      scope: 'WORKSPACE' as const,
      taskId: null,
      currency: 'EUR',
      limitMinorUnits: 250n,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      policyVersion: 'bridge-test-v1',
    };
    const taskPolicy = {
      ...workspacePolicy,
      policyId: `task-cost-policy-${suffix}`,
      scope: 'TASK' as const,
      taskId,
      limitMinorUnits: 100n,
    };
    await prisma.acpCostBudgetPolicy.createMany({
      data: [
        { ...workspacePolicy, policyHash: costBudgetPolicyHash(workspacePolicy) },
        { ...taskPolicy, policyHash: costBudgetPolicyHash(taskPolicy) },
      ].map(
        ({
          schemaVersion: _schemaVersion,
          policyId: id,
          periodStart: start,
          periodEnd: end,
          ...policy
        }) => ({
          ...policy,
          id,
          periodStart: new Date(start),
          periodEnd: new Date(end),
        }),
      ),
    });

    for (const [label, bytes] of [
      ['zero', 0],
      ['thirty-one', 31],
    ] as const) {
      const weakSecretReference = `vault-item-${label}-${suffix}`;
      const weakRuntimeId = `weak-runtime-${label}-${suffix}`;
      trustedSecrets.set(weakSecretReference, new Uint8Array(bytes));
      await expect(
        bridge.provisionRuntime(
          capability,
          { workspaceId, principalId },
          {
            runtimeId: weakRuntimeId,
            connectionId: `weak-connection-${label}-${suffix}`,
            adapterKind: 'DETERMINISTIC_FAKE',
            environment: 'TEST_ONLY',
            principalReference: `weak-principal-${label}-${suffix}`,
            secretReference: weakSecretReference,
            capabilityPolicyHash,
            idempotencyKey: `weak-provision-${label}-${suffix}`,
          },
        ),
      ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
      expect(
        await prisma.acpRuntime.findUnique({
          where: { workspaceId_id: { workspaceId, id: weakRuntimeId } },
        }),
      ).toBeNull();
    }
    const exactSecretReference = `vault-item-exact-${suffix}`;
    trustedSecrets.set(exactSecretReference, new Uint8Array(32).fill(9));
    expect(
      (
        await bridge.provisionRuntime(
          capability,
          { workspaceId, principalId },
          {
            runtimeId: `exact-runtime-${suffix}`,
            connectionId: `exact-connection-${suffix}`,
            adapterKind: 'DETERMINISTIC_FAKE',
            environment: 'TEST_ONLY',
            principalReference: `exact-principal-${suffix}`,
            secretReference: exactSecretReference,
            capabilityPolicyHash,
            idempotencyKey: `exact-provision-${suffix}`,
          },
        )
      ).runtime.secretDigest,
    ).toMatch(/^[a-f0-9]{64}$/u);

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
    expect(
      (
        await bridge.provisionRuntime(
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
        )
      ).replayed,
    ).toBe(true);

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
    expect(secretLeaseRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workspaceId,
          runtimeId,
          connectionId,
          secretReference,
          authGeneration: 1,
          purpose: 'PROVISION',
        }),
        expect.objectContaining({
          workspaceId,
          runtimeId,
          connectionId,
          secretReference,
          authGeneration: 1,
          purpose: 'AUTHENTICATE',
          expectedDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
        expect.objectContaining({
          workspaceId,
          runtimeId,
          connectionId,
          secretReference,
          authGeneration: 1,
          purpose: 'VERIFY_FRAME',
          expectedDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      ]),
    );
    expect(
      secretLeaseRequests.find((request) => request.purpose === 'PROVISION'),
    ).not.toHaveProperty('expectedDigest');

    dispatchId = `dispatch-${suffix}`;
    refreshCandidateSnapshot();
    const routed = await brokerReservations.reserveForPreparedRun(
      capability,
      { workspaceId, principalId },
      {
        reservationId: `broker-${suffix}`,
        runId,
        agentId: `fixture-agent-${suffix}`,
        expectedRunVersion: 1,
        idempotencyKey: `broker-${suffix}`,
      },
    );
    const prepared = await bridge.prepareDispatch(
      capability,
      { workspaceId, principalId },
      {
        dispatchId,
        agentId: `fixture-agent-${suffix}`,
        sessionId,
        idempotencyKey: `dispatch-idempotency-${suffix}`,
        brokerEvidence: {
          evidenceId: routed.reservation.id,
          evidenceHash: routed.reservation.evidenceHash,
          workspaceId,
          taskId,
          runId,
          agentId: `fixture-agent-${suffix}`,
          runtimeId,
          connectionId,
        },
      },
    );
    expect(
      (
        await prisma.acpBrokerReservation.findUniqueOrThrow({
          where: { workspaceId_id: { workspaceId, id: routed.reservation.id } },
        })
      ).state,
    ).toBe('CLAIMED');
    await expect(
      prisma.acpBrokerReservation.update({
        where: { workspaceId_id: { workspaceId, id: routed.reservation.id } },
        data: { state: 'RELEASED', releasedAt: new Date() },
      }),
    ).rejects.toThrow(/terminal exact dispatch required/iu);
    await expect(
      prisma.acpBrokerReservation.update({
        where: { workspaceId_id: { workspaceId, id: routed.reservation.id } },
        data: { state: 'RELEASED', claimedAt: new Date(0), releasedAt: new Date() },
      }),
    ).rejects.toThrow(/claim metadata is immutable/iu);
    await expect(
      prisma.acpBrokerReservation.update({
        where: { workspaceId_id: { workspaceId, id: routed.reservation.id } },
        data: { claimedAt: new Date(0) },
      }),
    ).rejects.toThrow(/lifecycle fields are immutable/iu);
    const assignmentEvidenceId = prepared.dispatch.assignmentEvidenceId;
    primaryAssignmentEvidenceId = assignmentEvidenceId;
    const capsuleId = `dispatch-capsule-${suffix}`;
    const preparedAuthorization = await bridge.prepareDispatchAuthorization(
      capability,
      { workspaceId, principalId },
      {
        capsuleId,
        dispatchId,
        idempotencyKey: `dispatch-capsule-${suffix}`,
      },
    );
    expect(preparedAuthorization.replayed).toBe(false);
    expect(preparedAuthorization.outbox).toMatchObject({
      id: capsuleId,
      workspaceId,
      runtimeId,
      connectionId,
      sessionId,
      dispatchId,
      taskId,
      runId,
      outboundSequence: 1,
      messageType: 'DISPATCH',
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      state: 'PREPARED',
    });
    expect(preparedAuthorization.frame).toMatchObject({
      type: 'DISPATCH',
      sequence: 1,
      messageId: capsuleId,
      workspaceId,
      runtimeId,
      connectionId,
      sessionId,
    });
    const outboundKeys = deriveBridgeKeys(secret, {
      workspaceId,
      runtimeId,
      connectionId,
      sessionId,
      principalReference: `fixture-principal-${suffix}`,
      parentNonce,
      runtimeNonce,
    });
    const observedAt = new Date(preparedAuthorization.frame.issuedAt);
    expect(() =>
      verifyBridgeEnvelope(
        preparedAuthorization.frame,
        outboundKeys.parentToRuntime,
        {
          workspaceId,
          runtimeId,
          connectionId,
          sessionId,
          principalReference: `fixture-principal-${suffix}`,
        },
        observedAt,
      ),
    ).not.toThrow();
    expect(() =>
      verifyBridgeEnvelope(
        preparedAuthorization.frame,
        outboundKeys.runtimeToParent,
        {
          workspaceId,
          runtimeId,
          connectionId,
          sessionId,
          principalReference: `fixture-principal-${suffix}`,
        },
        observedAt,
      ),
    ).toThrow(BridgeProtocolError);
    outboundKeys.parentToRuntime.fill(0);
    outboundKeys.runtimeToParent.fill(0);
    const durableCapsule = await prisma.acpBridgeDispatchOutbox.findUniqueOrThrow({
      where: { workspaceId_id: { workspaceId, id: capsuleId } },
    });
    expect(Object.keys(durableCapsule)).not.toEqual(
      expect.arrayContaining(['mac', 'payload', 'rawLine', 'principalReference']),
    );
    expect(JSON.stringify(durableCapsule)).not.toContain(preparedAuthorization.frame.mac);
    // Keep database-clock/time-zone proofs adjacent to the freshly prepared outbox.
    // Later adversarial claim checks must not turn this into an expiry test.
    const timezoneAttemptData = {
      id: `egress-timezone-${suffix}`,
      workspaceId,
      outboxId: durableCapsule.id,
      ownerReference: principalId,
      ownerActorKind: 'SYSTEM',
      claimIdempotencyKey: `egress-timezone-${suffix}`,
      generation: 1,
    };
    const insertTimezoneAttempt = (tx: Prisma.TransactionClient) =>
      tx.$executeRaw(Prisma.sql`
        WITH db_clock AS (
          SELECT date_trunc('milliseconds', clock_timestamp()) AS claimed_at
        )
        INSERT INTO "acp_bridge_egress_handoff_attempts" (
          "id", "workspaceId", "outboxId", "ownerReference", "ownerActorKind",
          "claimIdempotencyKey", "generation", "runtimeId", "connectionId", "sessionId",
          "dispatchId", "taskId", "runId", "agentId", "authorityLevel", "outboundSequence",
          "messageId", "messageType", "protocolVersion", "outboxState", "brokerEvidenceId",
          "brokerEvidenceHash", "assignmentEvidenceId", "assignmentEvidenceHash",
          "dispatchEnvelopeHash", "policyHash", "capabilityPolicyHash", "capabilityDigest",
          "payloadDigest", "unsignedEnvelopeDigest", "signedEnvelopeDigest",
          "authenticationTagDigest", "outboxIdempotencyKey", "outboxIssuedAt", "outboxExpiresAt",
          "outboxPreparedAt", "claimedAt", "expiresAt"
        )
        SELECT
          ${timezoneAttemptData.id}, source."workspaceId", source."id", ${timezoneAttemptData.ownerReference},
          ${timezoneAttemptData.ownerActorKind}, ${timezoneAttemptData.claimIdempotencyKey},
          ${timezoneAttemptData.generation}, source."runtimeId", source."connectionId", source."sessionId",
          source."dispatchId", source."taskId", source."runId", source."agentId",
          source."authorityLevel", source."outboundSequence", source."messageId", source."messageType",
          source."protocolVersion", source."state", source."brokerEvidenceId", source."brokerEvidenceHash",
          source."assignmentEvidenceId", source."assignmentEvidenceHash", source."dispatchEnvelopeHash",
          source."policyHash", source."capabilityPolicyHash", source."capabilityDigest",
          source."payloadDigest", source."unsignedEnvelopeDigest", source."signedEnvelopeDigest",
          source."authenticationTagDigest", source."idempotencyKey", source."issuedAt", source."expiresAt",
          source."preparedAt", db_clock.claimed_at,
          LEAST(db_clock.claimed_at + INTERVAL '10 seconds', source."expiresAt")
        FROM db_clock
        JOIN "acp_bridge_dispatch_outbox" source
          ON source."workspaceId" = ${timezoneAttemptData.workspaceId}::uuid
         AND source."id" = ${timezoneAttemptData.outboxId}
      `);
    const setStaleTimezoneHeartbeat = (tx: Prisma.TransactionClient) =>
      tx.$executeRaw(Prisma.sql`
        UPDATE "acp_runtime_connections"
        SET "lastHeartbeatAt" = (clock_timestamp() - INTERVAL '61 seconds') AT TIME ZONE 'UTC',
            "version" = "version" + 1
        WHERE "workspaceId" = ${workspaceId}::uuid AND "id" = ${connectionId}
      `);
    const setFreshTimezoneHeartbeat = (tx: Prisma.TransactionClient) =>
      tx.$executeRaw(Prisma.sql`
        UPDATE "acp_runtime_connections"
        SET "lastHeartbeatAt" = clock_timestamp() AT TIME ZONE 'UTC',
            "version" = "version" + 1
        WHERE "workspaceId" = ${workspaceId}::uuid AND "id" = ${connectionId}
      `);
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`SET LOCAL TIME ZONE 'America/Adak'`);
        expect(await setStaleTimezoneHeartbeat(tx)).toBe(1);
        return insertTimezoneAttempt(tx);
      }),
    ).rejects.toThrow(/live prepared durable authority/iu);
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`SET LOCAL TIME ZONE 'Pacific/Kiritimati'`);
        expect(await setStaleTimezoneHeartbeat(tx)).toBe(1);
        return insertTimezoneAttempt(tx);
      }),
    ).rejects.toThrow(/live prepared durable authority/iu);
    const directWriterAuditCount = await prisma.auditEvent.count({
      where: {
        workspaceReference: workspaceId,
        entityType: 'AcpBridgeEgressHandoffAttempt',
      },
    });
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`SET LOCAL TIME ZONE 'America/Adak'`);
        expect(await setFreshTimezoneHeartbeat(tx)).toBe(1);
        expect(await insertTimezoneAttempt(tx)).toBe(1);
        throw new Error('rollback fresh Adak timezone proof');
      }),
    ).rejects.toThrow('rollback fresh Adak timezone proof');
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SET LOCAL TIME ZONE 'Pacific/Kiritimati'`);
      expect(await setFreshTimezoneHeartbeat(tx)).toBe(1);
      expect(await insertTimezoneAttempt(tx)).toBe(1);
    });
    expect(
      await prisma.auditEvent.count({
        where: {
          workspaceReference: workspaceId,
          entityType: 'AcpBridgeEgressHandoffAttempt',
        },
      }),
    ).toBe(directWriterAuditCount);
    await bridge.releaseDispatchEgressHandoff(
      capability,
      { workspaceId, principalId },
      {
        releaseId: `egress-timezone-release-${suffix}`,
        attemptId: timezoneAttemptData.id,
        idempotencyKey: `egress-timezone-release-${suffix}`,
      },
    );
    const handoffId = `egress-handoff-${suffix}`;
    const handoff = await bridge.claimDispatchEgressHandoff(
      capability,
      { workspaceId, principalId },
      {
        attemptId: handoffId,
        outboxId: capsuleId,
        idempotencyKey: `egress-handoff-${suffix}`,
      },
    );
    expect(handoff.replayed).toBe(false);
    expect(handoff.attempt).toMatchObject({
      id: handoffId,
      workspaceId,
      outboxId: capsuleId,
      ownerReference: principalId,
      ownerActorKind: 'SYSTEM',
      generation: 2,
      dispatchId,
      outboxState: 'PREPARED',
    });
    expect(handoff.frame).toEqual(preparedAuthorization.frame);
    expect(handoff.attempt.expiresAt.getTime()).toBeLessThanOrEqual(
      handoff.attempt.claimedAt.getTime() + 15_000,
    );
    const durableHandoff = await prisma.acpBridgeEgressHandoffAttempt.findUniqueOrThrow({
      where: { workspaceId_id: { workspaceId, id: handoffId } },
    });
    expect(Object.keys(durableHandoff)).not.toEqual(
      expect.arrayContaining([
        'mac',
        'payload',
        'rawLine',
        'principalReference',
        'secretReference',
      ]),
    );
    expect(JSON.stringify(durableHandoff)).not.toContain(handoff.frame.mac);
    expect(
      (
        await bridge.claimDispatchEgressHandoff(
          capability,
          { workspaceId, principalId },
          {
            attemptId: handoffId,
            outboxId: capsuleId,
            idempotencyKey: `egress-handoff-${suffix}`,
          },
        )
      ).replayed,
    ).toBe(true);
    const copiedOwnerPrincipalId = `bridge-copy-${suffix}`;
    const copiedOwnerCapability = OperationalEventCapability.issue('CONTROL_PLANE', [
      {
        workspaceId,
        principalId: copiedOwnerPrincipalId,
        actorKind: 'SYSTEM',
        authorityLevel: 3,
      },
    ]);
    const secretRequestsBeforeCopiedOwner = secretLeaseRequests.length;
    await expect(
      bridge.claimDispatchEgressHandoff(
        copiedOwnerCapability,
        { workspaceId, principalId: copiedOwnerPrincipalId },
        {
          attemptId: handoffId,
          outboxId: capsuleId,
          idempotencyKey: `egress-handoff-${suffix}`,
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionConflictError);
    await expect(
      bridge.releaseDispatchEgressHandoff(
        copiedOwnerCapability,
        { workspaceId, principalId: copiedOwnerPrincipalId },
        {
          releaseId: `egress-copied-release-${suffix}`,
          attemptId: handoffId,
          idempotencyKey: `egress-copied-release-${suffix}`,
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionConflictError);
    const actorDriftCapability = OperationalEventCapability.issue('CONTROL_PLANE', [
      { workspaceId, principalId, actorKind: 'AGENT', authorityLevel: 3 },
    ]);
    await expect(
      bridge.claimDispatchEgressHandoff(
        actorDriftCapability,
        { workspaceId, principalId },
        {
          attemptId: handoffId,
          outboxId: capsuleId,
          idempotencyKey: `egress-handoff-${suffix}`,
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionConflictError);
    expect(secretLeaseRequests).toHaveLength(secretRequestsBeforeCopiedOwner);
    expect(
      await prisma.acpBridgeEgressHandoffRelease.count({
        where: { workspaceId, attemptId: handoffId },
      }),
    ).toBe(0);
    await expect(
      bridge.claimDispatchEgressHandoff(
        capability,
        { workspaceId, principalId },
        {
          attemptId: `egress-competitor-${suffix}`,
          outboxId: capsuleId,
          idempotencyKey: `egress-competitor-${suffix}`,
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionConflictError);
    await expect(
      bridge.claimDispatchEgressHandoff(
        capability,
        { workspaceId, principalId },
        {
          attemptId: `egress-private-${suffix}`,
          outboxId: capsuleId,
          idempotencyKey: 'token-reference',
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    const auditSubjectSecretRequests = secretLeaseRequests.length;
    let auditSubjectSourceCalls = 0;
    const auditSubjectBridge = testBridge(testSecretLease(), {
      async verify() {
        auditSubjectSourceCalls += 1;
        throw new Error('audit subject validation reached the evidence source');
      },
    });
    await expect(
      auditSubjectBridge.claimDispatchEgressHandoff(
        capability,
        { workspaceId, principalId },
        {
          attemptId: `egress@attempt-${suffix}`,
          outboxId: capsuleId,
          idempotencyKey: `egress-valid-idempotency-${suffix}`,
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    await expect(
      auditSubjectBridge.releaseDispatchEgressHandoff(
        capability,
        { workspaceId, principalId },
        {
          releaseId: `egress@release-${suffix}`,
          attemptId: handoffId,
          idempotencyKey: `egress-valid-release-idempotency-${suffix}`,
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    expect(auditSubjectSourceCalls).toBe(0);
    expect(secretLeaseRequests).toHaveLength(auditSubjectSecretRequests);
    await expect(
      prisma.acpBridgeEgressHandoffAttempt.update({
        where: { workspaceId_id: { workspaceId, id: handoffId } },
        data: { ownerReference: `changed-owner-${suffix}` },
      }),
    ).rejects.toThrow(/immutable/iu);
    await expect(
      prisma.acpBridgeEgressHandoffAttempt.create({
        data: {
          ...durableHandoff,
          id: `forged-handoff-${suffix}`,
          claimIdempotencyKey: `forged-handoff-${suffix}`,
          ownerReference: `forged-owner-${suffix}`,
          generation: 3,
          payloadDigest: '0'.repeat(64),
          claimedAt: new Date(),
          expiresAt: new Date(Date.now() + 5_000),
        },
      }),
    ).rejects.toThrow(/durable binding mismatch/iu);
    await expect(
      prisma.acpBridgeEgressHandoffRelease.create({
        data: {
          id: `egress@release-sql-${suffix}`,
          workspaceId,
          attemptId: handoffId,
          outboxId: durableHandoff.outboxId,
          ownerReference: durableHandoff.ownerReference,
          ownerActorKind: durableHandoff.ownerActorKind,
          generation: durableHandoff.generation,
          releaseIdempotencyKey: `egress-release-sql-${suffix}`,
          releasedAt: new Date(),
        },
      }),
    ).rejects.toThrow(/reference_check|check constraint/iu);
    const released = await bridge.releaseDispatchEgressHandoff(
      capability,
      { workspaceId, principalId },
      {
        releaseId: `egress-release-${suffix}`,
        attemptId: handoffId,
        idempotencyKey: `egress-release-${suffix}`,
      },
    );
    expect(released.replayed).toBe(false);
    expect(
      (
        await bridge.releaseDispatchEgressHandoff(
          capability,
          { workspaceId, principalId },
          {
            releaseId: `egress-release-${suffix}`,
            attemptId: handoffId,
            idempotencyKey: `egress-release-${suffix}`,
          },
        )
      ).replayed,
    ).toBe(true);
    await expect(
      prisma.acpBridgeEgressHandoffRelease.update({
        where: {
          workspaceId_id: { workspaceId, id: `egress-release-${suffix}` },
        },
        data: { releasedAt: new Date() },
      }),
    ).rejects.toThrow(/immutable/iu);
    const shortClaimedAt = new Date();
    const shortAttemptData = {
      ...durableHandoff,
      id: `egress-short-${suffix}`,
      ownerReference: principalId,
      claimIdempotencyKey: `egress-short-${suffix}`,
      generation: 3,
      claimedAt: shortClaimedAt,
      expiresAt: new Date(
        Math.min(shortClaimedAt.getTime() + 1_500, durableCapsule.expiresAt.getTime()),
      ),
    };
    await prisma.acpBridgeEgressHandoffAttempt.create({ data: shortAttemptData });
    let reportClaimExpiryLock!: () => void;
    let releaseClaimExpiryLock!: () => void;
    const claimExpiryLocked = new Promise<void>((resolve) => {
      reportClaimExpiryLock = resolve;
    });
    const claimExpiryRelease = new Promise<void>((resolve) => {
      releaseClaimExpiryLock = resolve;
    });
    const claimExpiryBlocker = prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "acp_bridge_sessions" WHERE "workspaceId" = ${workspaceId}::uuid AND "id" = ${sessionId} FOR UPDATE`,
      );
      reportClaimExpiryLock();
      await claimExpiryRelease;
    });
    await claimExpiryLocked;
    const secretRequestsBeforeExpiryWait = secretLeaseRequests.length;
    const expiredReplay = bridge.claimDispatchEgressHandoff(
      capability,
      { workspaceId, principalId },
      {
        attemptId: shortAttemptData.id,
        outboxId: capsuleId,
        idempotencyKey: shortAttemptData.claimIdempotencyKey,
      },
    );
    expect(
      await Promise.race([
        expiredReplay.then(
          () => 'settled',
          () => 'settled',
        ),
        new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 100)),
      ]),
    ).toBe('pending');
    await new Promise<void>((resolve) => setTimeout(resolve, 1_600));
    releaseClaimExpiryLock();
    await claimExpiryBlocker;
    await expect(expiredReplay).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    expect(secretLeaseRequests).toHaveLength(secretRequestsBeforeExpiryWait);
    const reclaimed = await bridge.claimDispatchEgressHandoff(
      capability,
      { workspaceId, principalId },
      {
        attemptId: `egress-reclaim-${suffix}`,
        outboxId: capsuleId,
        idempotencyKey: `egress-reclaim-${suffix}`,
      },
    );
    expect(reclaimed.attempt.generation).toBe(4);
    expect(reclaimed.replayed).toBe(false);
    await expect(
      prisma.acpBridgeEgressHandoffRelease.create({
        data: {
          id: `egress-private-release-${suffix}`,
          workspaceId,
          attemptId: reclaimed.attempt.id,
          outboxId: reclaimed.attempt.outboxId,
          ownerReference: principalId,
          ownerActorKind: 'SYSTEM',
          generation: reclaimed.attempt.generation,
          releaseIdempotencyKey: 'github_pat_1234567890abcdef',
          releasedAt: new Date(),
        },
      }),
    ).rejects.toThrow(/reference_check|check constraint/iu);
    let reportHandoffLease!: () => void;
    let releaseHandoffLease!: () => void;
    const handoffLeaseReached = new Promise<void>((resolve) => {
      reportHandoffLease = resolve;
    });
    const handoffLeaseRelease = new Promise<void>((resolve) => {
      releaseHandoffLease = resolve;
    });
    const crossingBridge = testBridge(
      testSecretLease(async (request) => {
        reportHandoffLease();
        await handoffLeaseRelease;
        const material = trustedSecrets.get(request.secretReference);
        if (!material) throw new Error('synthetic source unavailable');
        return material;
      }),
    );
    const crossingClaim = crossingBridge.claimDispatchEgressHandoff(
      capability,
      { workspaceId, principalId },
      {
        attemptId: `egress-reclaim-${suffix}`,
        outboxId: capsuleId,
        idempotencyKey: `egress-reclaim-${suffix}`,
      },
    );
    await handoffLeaseReached;
    const crossingInbound = bridge.acceptRuntimeMessage(
      capability,
      { workspaceId, principalId },
      fake.emitAt(4, 'PROGRESS', { dispatchId, progressCode: 'EARLY_CROSSING' }),
    );
    expect(
      await Promise.race([
        crossingInbound.then(
          () => 'settled',
          () => 'settled',
        ),
        new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 100)),
      ]),
    ).toBe('pending');
    releaseHandoffLease();
    expect((await crossingClaim).replayed).toBe(true);
    await expect(crossingInbound).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    expect(
      await prisma.acpBridgeReceipt.count({ where: { workspaceId, sessionId, sequence: 4 } }),
    ).toBe(0);
    await bridge.releaseDispatchEgressHandoff(
      capability,
      { workspaceId, principalId },
      {
        releaseId: `egress-reclaim-release-${suffix}`,
        attemptId: `egress-reclaim-${suffix}`,
        idempotencyKey: `egress-reclaim-release-${suffix}`,
      },
    );
    const privacyClaimedAt = new Date();
    await expect(
      prisma.acpBridgeEgressHandoffAttempt.create({
        data: {
          ...durableHandoff,
          id: `egress@attempt-sql-${suffix}`,
          claimIdempotencyKey: `egress-attempt-sql-${suffix}`,
          generation: 5,
          claimedAt: privacyClaimedAt,
          expiresAt: new Date(
            Math.min(privacyClaimedAt.getTime() + 5_000, durableCapsule.expiresAt.getTime()),
          ),
        },
      }),
    ).rejects.toThrow(/reference_check|check constraint/iu);
    await expect(
      prisma.acpBridgeEgressHandoffAttempt.create({
        data: {
          ...durableHandoff,
          id: `egress-at-owner-sql-${suffix}`,
          ownerReference: 'principal@domain.example',
          ownerActorKind: 'SYSTEM',
          claimIdempotencyKey: `egress-at-owner-sql-${suffix}`,
          generation: 5,
          claimedAt: privacyClaimedAt,
          expiresAt: new Date(
            Math.min(privacyClaimedAt.getTime() + 5_000, durableCapsule.expiresAt.getTime()),
          ),
        },
      }),
    ).rejects.toThrow(/reference_check|check constraint/iu);
    await expect(
      prisma.acpBridgeEgressHandoffAttempt.create({
        data: {
          ...durableHandoff,
          id: `egress-oversized-owner-sql-${suffix}`,
          ownerReference: `7${'a'.repeat(256)}`,
          ownerActorKind: 'SYSTEM',
          claimIdempotencyKey: `egress-oversized-owner-sql-${suffix}`,
          generation: 5,
          claimedAt: privacyClaimedAt,
          expiresAt: new Date(
            Math.min(privacyClaimedAt.getTime() + 5_000, durableCapsule.expiresAt.getTime()),
          ),
        },
      }),
    ).rejects.toThrow(/reference_check|check constraint/iu);
    for (const [index, privateReference] of [
      'token-reference',
      'github_pat_1234567890abcdef',
      'npm_1234567890abcdef',
      'hf_1234567890abcdef',
      'AKIA1234567890ABCDEF',
      'AIza1234567890abcdefghijklmnop',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwcml2YXRlIn0.signature123456',
      'alice:opaquevalue@host.example',
    ].entries()) {
      await expect(
        prisma.acpBridgeEgressHandoffAttempt.create({
          data: {
            ...durableHandoff,
            id: `egress-private-sql-${index}-${suffix}`,
            ownerReference: privateReference,
            ownerActorKind: 'SYSTEM',
            claimIdempotencyKey: `egress-private-sql-${index}-${suffix}`,
            generation: 5,
            claimedAt: privacyClaimedAt,
            expiresAt: new Date(
              Math.min(privacyClaimedAt.getTime() + 5_000, durableCapsule.expiresAt.getTime()),
            ),
          },
        }),
      ).rejects.toThrow(/reference_check|check constraint/iu);
    }
    const concurrentClaims = await Promise.allSettled(
      ['a', 'b'].map((candidate) =>
        bridge.claimDispatchEgressHandoff(
          capability,
          { workspaceId, principalId },
          {
            attemptId: `egress-race-${candidate}-${suffix}`,
            outboxId: capsuleId,
            idempotencyKey: `egress-race-${candidate}-${suffix}`,
          },
        ),
      ),
    );
    expect(concurrentClaims.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(concurrentClaims.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const raceWinnerResult = concurrentClaims.find((result) => result.status === 'fulfilled');
    if (!raceWinnerResult || raceWinnerResult.status !== 'fulfilled') {
      throw new Error('expected one exclusive egress handoff winner');
    }
    const raceWinner = raceWinnerResult.value;
    expect(raceWinner.attempt.generation).toBe(5);
    await bridge.releaseDispatchEgressHandoff(
      capability,
      { workspaceId, principalId },
      {
        releaseId: `egress-race-release-${suffix}`,
        attemptId: raceWinner.attempt.id,
        idempotencyKey: `egress-race-release-${suffix}`,
      },
    );
    const digitLeadingPrincipalId = `7${randomUUID().slice(1)}`;
    const digitLeadingCapability = OperationalEventCapability.issue('CONTROL_PLANE', [
      {
        workspaceId,
        principalId: digitLeadingPrincipalId,
        actorKind: 'SYSTEM',
        authorityLevel: 3,
      },
    ]);
    const digitLeadingClaim = await bridge.claimDispatchEgressHandoff(
      digitLeadingCapability,
      { workspaceId, principalId: digitLeadingPrincipalId },
      {
        attemptId: `egress-digit-owner-${suffix}`,
        outboxId: capsuleId,
        idempotencyKey: `egress-digit-owner-${suffix}`,
      },
    );
    expect(digitLeadingClaim.attempt).toMatchObject({
      ownerReference: digitLeadingPrincipalId,
      ownerActorKind: 'SYSTEM',
      generation: 6,
    });
    await bridge.releaseDispatchEgressHandoff(
      digitLeadingCapability,
      { workspaceId, principalId: digitLeadingPrincipalId },
      {
        releaseId: `egress-digit-release-${suffix}`,
        attemptId: digitLeadingClaim.attempt.id,
        idempotencyKey: `egress-digit-release-${suffix}`,
      },
    );
    const punctuatedPrincipalId = `7/:${'a'.repeat(253)}`;
    expect(punctuatedPrincipalId).toHaveLength(256);
    const punctuatedCapability = OperationalEventCapability.issue('CONTROL_PLANE', [
      {
        workspaceId,
        principalId: punctuatedPrincipalId,
        actorKind: 'SYSTEM',
        authorityLevel: 3,
      },
    ]);
    const punctuatedClaimIdempotencyKey = `egress-punctuated@owner-${suffix}`;
    const punctuatedReleaseIdempotencyKey = `egress-punctuated@release-${suffix}`;
    const punctuatedClaim = await bridge.claimDispatchEgressHandoff(
      punctuatedCapability,
      { workspaceId, principalId: punctuatedPrincipalId },
      {
        attemptId: `egress-punctuated-owner-${suffix}`,
        outboxId: capsuleId,
        idempotencyKey: punctuatedClaimIdempotencyKey,
      },
    );
    expect(punctuatedClaim.attempt).toMatchObject({
      ownerReference: punctuatedPrincipalId,
      ownerActorKind: 'SYSTEM',
      generation: 7,
    });
    expect(
      (
        await bridge.claimDispatchEgressHandoff(
          punctuatedCapability,
          { workspaceId, principalId: punctuatedPrincipalId },
          {
            attemptId: punctuatedClaim.attempt.id,
            outboxId: capsuleId,
            idempotencyKey: punctuatedClaimIdempotencyKey,
          },
        )
      ).replayed,
    ).toBe(true);
    const punctuatedRelease = await bridge.releaseDispatchEgressHandoff(
      punctuatedCapability,
      { workspaceId, principalId: punctuatedPrincipalId },
      {
        releaseId: `egress-punctuated-release-${suffix}`,
        attemptId: punctuatedClaim.attempt.id,
        idempotencyKey: punctuatedReleaseIdempotencyKey,
      },
    );
    expect(punctuatedRelease.replayed).toBe(false);
    expect(
      (
        await bridge.releaseDispatchEgressHandoff(
          punctuatedCapability,
          { workspaceId, principalId: punctuatedPrincipalId },
          {
            releaseId: punctuatedRelease.release.id,
            attemptId: punctuatedClaim.attempt.id,
            idempotencyKey: punctuatedReleaseIdempotencyKey,
          },
        )
      ).replayed,
    ).toBe(true);
    const punctuatedClaimAuditKey = `bridge-egress-claim:${sha256Canonical({
      domain: 'ventureos.bridge.egress.claim.audit.v1',
      workspaceId,
      attemptId: punctuatedClaim.attempt.id,
      outboxId: punctuatedClaim.attempt.outboxId,
      ownerReference: punctuatedClaim.attempt.ownerReference,
      ownerActorKind: punctuatedClaim.attempt.ownerActorKind,
      claimIdempotencyKey: punctuatedClaimIdempotencyKey,
    })}`;
    const punctuatedReleaseAuditKey = `bridge-egress-release:${sha256Canonical({
      domain: 'ventureos.bridge.egress.release.audit.v1',
      workspaceId,
      releaseId: punctuatedRelease.release.id,
      attemptId: punctuatedRelease.release.attemptId,
      outboxId: punctuatedRelease.release.outboxId,
      ownerReference: punctuatedRelease.release.ownerReference,
      ownerActorKind: punctuatedRelease.release.ownerActorKind,
      releaseIdempotencyKey: punctuatedReleaseIdempotencyKey,
    })}`;
    const punctuatedAuditRows = await prisma.auditEvent.findMany({
      where: {
        workspaceReference: workspaceId,
        idempotencyKey: { in: [punctuatedClaimAuditKey, punctuatedReleaseAuditKey] },
      },
      orderBy: { idempotencyKey: 'asc' },
    });
    expect(punctuatedAuditRows).toHaveLength(2);
    expect(punctuatedAuditRows.map((row) => row.idempotencyKey).sort()).toEqual(
      [punctuatedClaimAuditKey, punctuatedReleaseAuditKey].sort(),
    );
    expect(punctuatedClaimAuditKey).not.toBe(punctuatedReleaseAuditKey);
    expect(JSON.stringify(punctuatedAuditRows)).not.toContain(punctuatedClaimIdempotencyKey);
    expect(JSON.stringify(punctuatedAuditRows)).not.toContain(punctuatedReleaseIdempotencyKey);
    const secretRequestsBeforeAtOwner = secretLeaseRequests.length;
    expect(() =>
      OperationalEventCapability.issue('CONTROL_PLANE', [
        {
          workspaceId,
          principalId: `principal@domain-${suffix}`,
          actorKind: 'SYSTEM',
          authorityLevel: 3,
        },
      ]),
    ).toThrow();
    expect(secretLeaseRequests).toHaveLength(secretRequestsBeforeAtOwner);
    const oversizedPrincipalId = `7${'a'.repeat(256)}`;
    const secretRequestsBeforeOversizedOwner = secretLeaseRequests.length;
    expect(() =>
      OperationalEventCapability.issue('CONTROL_PLANE', [
        {
          workspaceId,
          principalId: oversizedPrincipalId,
          actorKind: 'SYSTEM',
          authorityLevel: 3,
        },
      ]),
    ).toThrow();
    expect(secretLeaseRequests).toHaveLength(secretRequestsBeforeOversizedOwner);
    const leaseRequestsBeforePreflightDenials = secretLeaseRequests.length;
    const level2Capability = OperationalEventCapability.issue('CONTROL_PLANE', [
      { workspaceId, principalId, actorKind: 'SYSTEM', authorityLevel: 2 },
    ]);
    await expect(
      bridge.claimDispatchEgressHandoff(
        level2Capability,
        { workspaceId, principalId },
        {
          attemptId: `egress-level2-${suffix}`,
          outboxId: capsuleId,
          idempotencyKey: `egress-level2-${suffix}`,
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    await expect(
      bridge.claimDispatchEgressHandoff(
        capability,
        { workspaceId: otherWorkspaceId, principalId },
        {
          attemptId: `egress-other-workspace-${suffix}`,
          outboxId: capsuleId,
          idempotencyKey: `egress-other-workspace-${suffix}`,
        },
      ),
    ).rejects.toThrow();
    expect(secretLeaseRequests).toHaveLength(leaseRequestsBeforePreflightDenials);

    const beforeLeaseDenial = {
      attempts: await prisma.acpBridgeEgressHandoffAttempt.count({ where: { workspaceId } }),
      audit: await prisma.auditEvent.count({ where: { workspaceReference: workspaceId } }),
    };
    await expect(
      testBridge(new DenyBridgeSecretLeaseResolver()).claimDispatchEgressHandoff(
        capability,
        { workspaceId, principalId },
        {
          attemptId: `egress-denied-lease-${suffix}`,
          outboxId: capsuleId,
          idempotencyKey: `egress-denied-lease-${suffix}`,
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    expect(await prisma.acpBridgeEgressHandoffAttempt.count({ where: { workspaceId } })).toBe(
      beforeLeaseDenial.attempts,
    );
    expect(await prisma.auditEvent.count({ where: { workspaceReference: workspaceId } })).toBe(
      beforeLeaseDenial.audit,
    );

    const failingAudit = new AuditService();
    failingAudit.recordOperationalEvent = async () => {
      throw new Error('synthetic audit failure');
    };
    await expect(
      testBridge(testSecretLease(), brokerReservations, failingAudit).claimDispatchEgressHandoff(
        capability,
        { workspaceId, principalId },
        {
          attemptId: `egress-audit-rollback-${suffix}`,
          outboxId: capsuleId,
          idempotencyKey: `egress-audit-rollback-${suffix}`,
        },
      ),
    ).rejects.toThrow(/synthetic audit failure/iu);
    expect(await prisma.acpBridgeEgressHandoffAttempt.count({ where: { workspaceId } })).toBe(
      beforeLeaseDenial.attempts,
    );

    await prisma.acpRuntimeConnection.update({
      where: { workspaceId_id: { workspaceId, id: connectionId } },
      data: { lastHeartbeatAt: new Date(Date.now() - 59_250), version: { increment: 1 } },
    });
    const delayedClaim = testBridge(
      testSecretLease(async (request) => {
        await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
        const material = trustedSecrets.get(request.secretReference);
        if (!material) throw new Error('synthetic source unavailable');
        return material;
      }),
    ).claimDispatchEgressHandoff(
      capability,
      { workspaceId, principalId },
      {
        attemptId: `egress-post-lease-expiry-${suffix}`,
        outboxId: capsuleId,
        idempotencyKey: `egress-post-lease-expiry-${suffix}`,
      },
    );
    await expect(delayedClaim).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    expect(await prisma.acpBridgeEgressHandoffAttempt.count({ where: { workspaceId } })).toBe(
      beforeLeaseDenial.attempts,
    );
    await prisma.acpRuntimeConnection.update({
      where: { workspaceId_id: { workspaceId, id: connectionId } },
      data: { lastHeartbeatAt: new Date(), version: { increment: 1 } },
    });
    const attemptsBeforeResolverMisbehavior = await prisma.acpBridgeEgressHandoffAttempt.count({
      where: { workspaceId },
    });
    const skippingResolver: BridgeSecretLeaseResolver = {
      async withSecret<T>() {
        return undefined as T;
      },
    };
    await expect(
      testBridge(skippingResolver).claimDispatchEgressHandoff(
        capability,
        { workspaceId, principalId },
        {
          attemptId: `egress-skipped-consumer-${suffix}`,
          outboxId: capsuleId,
          idempotencyKey: `egress-skipped-consumer-${suffix}`,
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    const swallowingResolver: BridgeSecretLeaseResolver = {
      async withSecret<T>(_request, consumer) {
        try {
          return await consumer(Buffer.from('incorrect-synthetic-material-32bytes'));
        } catch {
          return undefined as T;
        }
      },
    };
    await expect(
      testBridge(swallowingResolver).claimDispatchEgressHandoff(
        capability,
        { workspaceId, principalId },
        {
          attemptId: `egress-swallowed-consumer-${suffix}`,
          outboxId: capsuleId,
          idempotencyKey: `egress-swallowed-consumer-${suffix}`,
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    expect(await prisma.acpBridgeEgressHandoffAttempt.count({ where: { workspaceId } })).toBe(
      attemptsBeforeResolverMisbehavior,
    );
    expect(
      await prisma.acpRuntimeConnection.findUniqueOrThrow({
        where: { workspaceId_id: { workspaceId, id: connectionId } },
        select: { status: true },
      }),
    ).toEqual({ status: 'PARTIAL' });
    expect(
      await prisma.acpBridgeDispatch.findUniqueOrThrow({
        where: { workspaceId_id: { workspaceId, id: dispatchId } },
        select: { state: true },
      }),
    ).toEqual({ state: 'PREPARED' });
    expect(
      (
        await bridge.prepareDispatchAuthorization(
          capability,
          { workspaceId, principalId },
          {
            capsuleId,
            dispatchId,
            idempotencyKey: `dispatch-capsule-${suffix}`,
          },
        )
      ).replayed,
    ).toBe(true);
    await expect(
      bridge.prepareDispatchAuthorization(
        capability,
        { workspaceId, principalId },
        {
          capsuleId: `drifted-capsule-${suffix}`,
          dispatchId,
          idempotencyKey: `dispatch-capsule-${suffix}`,
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionConflictError);
    await expect(
      prisma.acpBridgeDispatchOutbox.update({
        where: { workspaceId_id: { workspaceId, id: capsuleId } },
        data: { state: 'SENT' },
      }),
    ).rejects.toThrow(/immutable/iu);
    expect(secretLeaseRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workspaceId,
          runtimeId,
          connectionId,
          purpose: 'SIGN_FRAME',
          expectedDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      ]),
    );
    const auditBeforePreparedRejections = await prisma.auditEvent.count({
      where: { workspaceReference: workspaceId },
    });
    const rejectedBeforeAcceptance = [
      ['PROGRESS', { dispatchId, progressCode: 'EARLY' }],
      [
        'ARTIFACT',
        {
          dispatchId,
          taskId,
          runId,
          evidenceId: `early-evidence-${suffix}`,
          evidenceHash: '8'.repeat(64),
          artifactId: `early-artifact-${suffix}`,
          criterion: 'artifact-one',
          kind: 'TEST_EVIDENCE',
          uriReference: `artifact://fixture/early/${suffix}`,
          contentHash: '9'.repeat(64),
        },
      ],
      ['USAGE', { dispatchId, taskId, runId, computeUnits: 1, costMinorUnits: 1, currency: 'EUR' }],
      ['RESULT', { dispatchId, resultCode: 'EARLY' }],
      ['FAILED', { dispatchId, resultCode: 'EARLY' }],
    ] as const;
    for (const [type, payload] of rejectedBeforeAcceptance) {
      await expect(
        bridge.acceptRuntimeMessage(
          capability,
          { workspaceId, principalId },
          fake.emitAt(4, type, payload),
        ),
      ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    }
    expect(
      await prisma.acpBridgeReceipt.count({ where: { workspaceId, sessionId, sequence: 4 } }),
    ).toBe(0);
    expect(await prisma.acpRunUsage.count({ where: { workspaceId, runId } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { workspaceReference: workspaceId } })).toBe(
      auditBeforePreparedRejections,
    );
    const beforeFreshnessRollback = {
      audit: await prisma.auditEvent.count({ where: { workspaceReference: workspaceId } }),
      connection: await prisma.acpRuntimeConnection.findUniqueOrThrow({
        where: { workspaceId_id: { workspaceId, id: connectionId } },
        select: {
          lastHeartbeatAt: true,
          lastHeartbeatHealth: true,
          lastHeartbeatSequence: true,
          status: true,
          version: true,
        },
      }),
    };
    const delayedIssuedAt = new Date(Date.now() - 59_000);
    const delayedExpiresAt = new Date(delayedIssuedAt.getTime() + 5 * 60_000);
    const delayedContext = {
      workspaceId,
      runtimeId,
      connectionId,
      sessionId,
      principalReference: `fixture-principal-${suffix}`,
      parentNonce: `parent_nonce_${suffix.replaceAll('-', '')}`,
      runtimeNonce: `runtime_nonce_${suffix.replaceAll('-', '')}`,
    };
    const delayedKeys = deriveBridgeKeys(secret, delayedContext);
    const delayedEnvelopeIdentity = {
      workspaceId: delayedContext.workspaceId,
      runtimeId: delayedContext.runtimeId,
      connectionId: delayedContext.connectionId,
      sessionId: delayedContext.sessionId,
      principalReference: delayedContext.principalReference,
    };
    const delayedFrame = (
      sequence: number,
      type: 'HEARTBEAT' | 'DISPATCH_ACCEPTED',
      payload: Readonly<Record<string, unknown>>,
    ) =>
      signBridgeEnvelope(
        {
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          ...delayedEnvelopeIdentity,
          sequence,
          messageId: `delayed-lock-message-${sequence}-${suffix}`,
          type,
          issuedAt: delayedIssuedAt.toISOString(),
          expiresAt: delayedExpiresAt.toISOString(),
          payloadDigest: digestBridgePayload(payload),
          payload,
        },
        delayedKeys.runtimeToParent,
      );
    const delayedHeartbeat = delayedFrame(4, 'HEARTBEAT', { health: 'HEALTHY' });
    const delayedAcceptance = delayedFrame(5, 'DISPATCH_ACCEPTED', {
      dispatchId,
      taskId,
      runId,
      evidenceId: assignmentEvidenceId,
      assignmentEvidenceHash: prepared.dispatch.assignmentEvidenceHash,
    });
    delayedKeys.parentToRuntime.fill(0);
    delayedKeys.runtimeToParent.fill(0);
    let releaseFreshnessLock!: () => void;
    let reportFreshnessLock!: () => void;
    const releaseFreshness = new Promise<void>((resolve) => {
      releaseFreshnessLock = resolve;
    });
    const freshnessLocked = new Promise<void>((resolve) => {
      reportFreshnessLock = resolve;
    });
    const freshnessBlocker = prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "acp_bridge_dispatches" WHERE "workspaceId" = ${workspaceId}::uuid AND "id" = ${dispatchId} FOR UPDATE`,
      );
      reportFreshnessLock();
      await releaseFreshness;
    });
    await freshnessLocked;
    const delayedAttempt = bridge.acceptAuthenticatedBatch(
      capability,
      { workspaceId, principalId },
      {
        sessionId,
        bytes: Buffer.concat([
          Buffer.from(encodeBridgeLine(delayedHeartbeat)),
          Buffer.from(encodeBridgeLine(delayedAcceptance)),
        ]),
      },
    );
    expect(
      await Promise.race([
        delayedAttempt.then(
          () => 'settled',
          () => 'settled',
        ),
        new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 100)),
      ]),
    ).toBe('pending');
    await new Promise<void>((resolve) => setTimeout(resolve, 1_150));
    releaseFreshnessLock();
    await freshnessBlocker;
    await expect(delayedAttempt).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    expect(
      await prisma.acpBridgeReceipt.count({
        where: { workspaceId, sessionId, sequence: { in: [4, 5] } },
      }),
    ).toBe(0);
    expect(
      await prisma.acpBridgeSession.findUniqueOrThrow({
        where: { workspaceId_id: { workspaceId, id: sessionId } },
        select: { expectedSequence: true, state: true },
      }),
    ).toEqual({ expectedSequence: 4, state: 'PARTIAL' });
    expect(
      await prisma.acpRuntimeConnection.findUniqueOrThrow({
        where: { workspaceId_id: { workspaceId, id: connectionId } },
        select: {
          lastHeartbeatAt: true,
          lastHeartbeatHealth: true,
          lastHeartbeatSequence: true,
          status: true,
          version: true,
        },
      }),
    ).toEqual(beforeFreshnessRollback.connection);
    expect(
      (
        await prisma.acpBridgeDispatch.findUniqueOrThrow({
          where: { workspaceId_id: { workspaceId, id: dispatchId } },
        })
      ).state,
    ).toBe('PREPARED');
    expect(await prisma.auditEvent.count({ where: { workspaceReference: workspaceId } })).toBe(
      beforeFreshnessRollback.audit,
    );
    const staleHeartbeatAt = new Date(Date.now() - 59_000);
    await prisma.acpRuntimeConnection.update({
      where: { workspaceId_id: { workspaceId, id: connectionId } },
      data: {
        lastHeartbeatAt: staleHeartbeatAt,
        lastHeartbeatHealth: 'HEALTHY',
        status: 'PARTIAL',
        version: { increment: 1 },
      },
    });
    const beforeAsyncVerifierRollback = {
      audit: await prisma.auditEvent.count({ where: { workspaceReference: workspaceId } }),
      connection: await prisma.acpRuntimeConnection.findUniqueOrThrow({
        where: { workspaceId_id: { workspaceId, id: connectionId } },
        select: {
          lastHeartbeatAt: true,
          lastHeartbeatHealth: true,
          lastHeartbeatSequence: true,
          status: true,
          version: true,
        },
      }),
    };
    let delayedBrokerVerifications = 0;
    const delayedBrokerBridge = testBridge(testSecretLease(), {
      async verify(evidence) {
        delayedBrokerVerifications += 1;
        await new Promise<void>((resolve) => setTimeout(resolve, 1_250));
        return brokerReservations.verify(evidence);
      },
    });
    const asyncDelayRuntime = new DeterministicFakeRuntime(delayedContext, secret, new Date());
    const staleFirstAcceptance = asyncDelayRuntime.emitAt(4, 'DISPATCH_ACCEPTED', {
      dispatchId,
      taskId,
      runId,
      evidenceId: assignmentEvidenceId,
      assignmentEvidenceHash: prepared.dispatch.assignmentEvidenceHash,
    });
    const tooLateHeartbeat = asyncDelayRuntime.emitAt(5, 'HEARTBEAT', { health: 'HEALTHY' });
    await expect(
      delayedBrokerBridge.acceptAuthenticatedBatch(
        capability,
        { workspaceId, principalId },
        {
          sessionId,
          bytes: Buffer.concat([
            Buffer.from(encodeBridgeLine(staleFirstAcceptance)),
            Buffer.from(encodeBridgeLine(tooLateHeartbeat)),
          ]),
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    expect(delayedBrokerVerifications).toBe(1);
    expect(
      await prisma.acpBridgeReceipt.count({
        where: { workspaceId, sessionId, sequence: { in: [4, 5] } },
      }),
    ).toBe(0);
    expect(
      await prisma.acpBridgeSession.findUniqueOrThrow({
        where: { workspaceId_id: { workspaceId, id: sessionId } },
        select: { expectedSequence: true, state: true },
      }),
    ).toEqual({ expectedSequence: 4, state: 'PARTIAL' });
    expect(
      await prisma.acpRuntimeConnection.findUniqueOrThrow({
        where: { workspaceId_id: { workspaceId, id: connectionId } },
        select: {
          lastHeartbeatAt: true,
          lastHeartbeatHealth: true,
          lastHeartbeatSequence: true,
          status: true,
          version: true,
        },
      }),
    ).toEqual(beforeAsyncVerifierRollback.connection);
    expect(
      (
        await prisma.acpBridgeDispatch.findUniqueOrThrow({
          where: { workspaceId_id: { workspaceId, id: dispatchId } },
        })
      ).state,
    ).toBe('PREPARED');
    expect(await prisma.auditEvent.count({ where: { workspaceReference: workspaceId } })).toBe(
      beforeAsyncVerifierRollback.audit,
    );
    const freshHeartbeat = fake.emit('HEARTBEAT', { health: 'HEALTHY' });
    const freshAcceptance = fake.emit('DISPATCH_ACCEPTED', {
      dispatchId,
      taskId,
      runId,
      evidenceId: assignmentEvidenceId,
      assignmentEvidenceHash: prepared.dispatch.assignmentEvidenceHash,
    });
    expect(
      (
        await bridge.acceptAuthenticatedBatch(
          capability,
          { workspaceId, principalId },
          {
            sessionId,
            bytes: Buffer.concat([
              Buffer.from(encodeBridgeLine(freshHeartbeat)),
              Buffer.from(encodeBridgeLine(freshAcceptance)),
            ]),
          },
        )
      ).map((receipt) => [receipt.messageType, receipt.sequence]),
    ).toEqual([
      ['HEARTBEAT', 4],
      ['DISPATCH_ACCEPTED', 5],
    ]);
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
    await expect(
      prisma.acpBridgeDispatch.update({
        where: { workspaceId_id: { workspaceId, id: dispatchId } },
        data: { state: 'COMPLETED', terminalAt: new Date() },
      }),
    ).rejects.toThrow();
    const auditBeforeReservation = await prisma.auditEvent.count({
      where: { workspaceReference: workspaceId },
    });
    for (const [type, payload] of rejectedBeforeAcceptance) {
      await expect(
        bridge.acceptRuntimeMessage(
          capability,
          { workspaceId, principalId },
          fake.emitAt(6, type, payload),
        ),
      ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    }
    expect(
      await prisma.acpBridgeReceipt.count({ where: { workspaceId, sessionId, sequence: 6 } }),
    ).toBe(0);
    expect(await prisma.acpRunUsage.count({ where: { workspaceId, runId } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { workspaceReference: workspaceId } })).toBe(
      auditBeforeReservation,
    );
    expect(
      (
        await prisma.acpBridgeDispatch.findUniqueOrThrow({
          where: { workspaceId_id: { workspaceId, id: dispatchId } },
        })
      ).state,
    ).toBe('ACCEPTED');

    const assignmentRace = await Promise.allSettled([
      taskRuns.reserveAssignment(
        capability,
        { workspaceId, principalId },
        assignment,
        1,
        `reserve-${suffix}`,
      ),
      bridge.acceptRuntimeMessage(
        capability,
        { workspaceId, principalId },
        fake.emitAt(6, 'RESULT', { dispatchId, resultCode: 'RACE_BEFORE_ASSIGNMENT' }),
      ),
    ]);
    const reservationOutcome = assignmentRace[0]!;
    expect(reservationOutcome.status).toBe('fulfilled');
    expect(assignmentRace[1]!.status).toBe('rejected');
    if (reservationOutcome.status !== 'fulfilled') throw reservationOutcome.reason;
    const assigned = reservationOutcome.value;
    const auditBeforeStart = await prisma.auditEvent.count({
      where: { workspaceReference: workspaceId },
    });
    for (const [type, payload] of rejectedBeforeAcceptance) {
      await expect(
        bridge.acceptRuntimeMessage(
          capability,
          { workspaceId, principalId },
          fake.emitAt(6, type, payload),
        ),
      ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    }
    expect(
      await prisma.acpBridgeReceipt.count({ where: { workspaceId, sessionId, sequence: 6 } }),
    ).toBe(0);
    expect(await prisma.acpRunUsage.count({ where: { workspaceId, runId } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { workspaceReference: workspaceId } })).toBe(
      auditBeforeStart,
    );
    expect(
      (
        await prisma.acpBridgeDispatch.findUniqueOrThrow({
          where: { workspaceId_id: { workspaceId, id: dispatchId } },
        })
      ).state,
    ).toBe('ACCEPTED');
    await taskRuns.startRun(
      capability,
      { workspaceId, principalId },
      runId,
      assigned.run.version,
      `start-${suffix}`,
    );

    await expect(
      bridge.acceptRuntimeMessage(
        capability,
        { workspaceId, principalId },
        fake.emitAt(6, 'ARTIFACT', {
          dispatchId,
          taskId,
          runId,
          evidenceId: `unverified-evidence-${suffix}`,
          evidenceHash: '5'.repeat(64),
          artifactId: `unverified-artifact-${suffix}`,
          criterion: 'artifact-one',
          kind: 'TEST_EVIDENCE',
          uriReference: `artifact://fixture/unverified/${suffix}`,
          contentHash: '6'.repeat(64),
        }),
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    expect(
      await prisma.acpBridgeReceipt.count({ where: { workspaceId, sessionId, sequence: 6 } }),
    ).toBe(0);
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
      trustedArtifactContent.set(evidence.uriReference, evidence.contentHash);
      await bridge.acceptRuntimeMessage(
        capability,
        { workspaceId, principalId },
        fake.emit('ARTIFACT', { dispatchId, ...evidence }),
      );
      expect(await bridge.verify(workspaceId, evidence)).toBe(true);
      trustedArtifactContent.delete(evidence.uriReference);
      expect(await bridge.verify(workspaceId, evidence)).toBe(false);
      trustedArtifactContent.set(evidence.uriReference, evidence.contentHash);
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
        fake.emitAt(9, 'USAGE', {
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
        where: { workspaceId, sessionId, sequence: 9 },
      }),
    ).toBe(0);
    const beforeAuditRollback = {
      receipts: await prisma.acpBridgeReceipt.count({ where: { workspaceId, dispatchId } }),
      usages: await prisma.acpRunUsage.count({ where: { workspaceId, dispatchId } }),
      ledger: await prisma.acpCostLedgerEntry.count({ where: { workspaceId, dispatchId } }),
    };
    const failingUsageAudit = {
      async recordOperationalEvent() {
        throw new Error('synthetic usage audit failure');
      },
    } as AuditService;
    const rollbackUsageBridge = new AcpBridgeAdmissionService(
      failingUsageAudit,
      testSecretLease(),
      brokerReservations,
      {
        async verify(_workspace, _runtime, policyHash, codes) {
          return (
            policyHash === capabilityPolicyHash && codes.join(',') === 'health.read,quality.verify'
          );
        },
      },
      {
        async verify(evidence) {
          return trustedArtifactContent.get(evidence.uriReference) === evidence.contentHash;
        },
      },
      {
        async allowsDeterministicFixture(requestWorkspaceId) {
          return requestWorkspaceId === workspaceId;
        },
      },
      new AcpCostGovernanceService(failingUsageAudit),
    );
    const usageSequence = (
      await prisma.acpBridgeSession.findUniqueOrThrow({
        where: { workspaceId_id: { workspaceId, id: sessionId } },
      })
    ).expectedSequence;
    await expect(
      rollbackUsageBridge.acceptRuntimeMessage(
        capability,
        { workspaceId, principalId },
        fake.emitAt(usageSequence, 'USAGE', {
          dispatchId,
          taskId,
          runId,
          computeUnits: 1,
          costMinorUnits: 1,
          currency: 'EUR',
        }),
      ),
    ).rejects.toThrow(/synthetic usage audit failure/iu);
    expect({
      receipts: await prisma.acpBridgeReceipt.count({ where: { workspaceId, dispatchId } }),
      usages: await prisma.acpRunUsage.count({ where: { workspaceId, dispatchId } }),
      ledger: await prisma.acpCostLedgerEntry.count({ where: { workspaceId, dispatchId } }),
    }).toEqual(beforeAuditRollback);
    await bridge.acceptRuntimeMessage(
      capability,
      { workspaceId, principalId },
      fake.emit('USAGE', {
        dispatchId,
        taskId,
        runId,
        computeUnits: 2,
        costMinorUnits: 2,
        currency: 'EUR',
      }),
    );
    const cumulativeUsage = await prisma.acpRunUsage.findFirstOrThrow({
      where: { workspaceId, dispatchId },
      orderBy: { sequence: 'desc' },
    });
    const cumulativeAudit = await prisma.auditEvent.findFirstOrThrow({
      where: {
        workspaceReference: workspaceId,
        source: 'CONTROL_PLANE',
        entityType: 'AcpRunUsage',
        entityId: cumulativeUsage.id,
      },
    });
    expect(cumulativeUsage.cumulativeComputeUnits).toBe(12n);
    expect(cumulativeUsage.cumulativeCostMinorUnits).toBe(7n);
    expect(cumulativeAudit.after).toMatchObject({
      computeUnits: 2,
      costMinorUnits: 2,
      taskComputeUsed: 12,
      taskCostUsedMinorUnits: 7,
    });

    const concurrentUsageReceiptIds = [
      `concurrent-usage-a-${suffix}`,
      `concurrent-usage-b-${suffix}`,
    ];
    let releaseFirst!: () => void;
    let signalFirst!: () => void;
    const firstReady = new Promise<void>((resolve) => {
      signalFirst = resolve;
    });
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const concurrentWrite = (index: number, hold: boolean) =>
      prisma.$transaction(
        async (tx) => {
          const receiptId = concurrentUsageReceiptIds[index]!;
          const sequence = 1_000 + index;
          const payloadDigest = `${index + 7}`.repeat(64);
          const recordedAt = new Date();
          await tx.acpBridgeReceipt.create({
            data: {
              id: receiptId,
              workspaceId,
              runtimeId,
              connectionId,
              sessionId,
              sequence,
              messageId: `concurrent-usage-message-${index}-${suffix}`,
              messageType: 'USAGE',
              payloadDigest,
              envelopeDigest: `${index + 8}`.repeat(64),
              taskId,
              runId,
              dispatchId,
            },
          });
          await tx.acpRunUsage.create({
            data: {
              id: receiptId,
              workspaceId,
              dispatchId,
              runId,
              sessionId,
              receiptId,
              sequence,
              computeUnits: 1,
              costMinorUnits: 1,
              cumulativeComputeUnits: 13n + BigInt(index),
              cumulativeCostMinorUnits: 8n + BigInt(index),
              currency: 'EUR',
              evidenceHash: payloadDigest,
              recordedAt,
            },
          });
          if (hold) {
            signalFirst();
            await firstRelease;
          }
          await costGovernance.recordUsage(capability, { workspaceId, principalId }, 'SYSTEM', tx, {
            usageId: receiptId,
            receiptId,
            dispatchId,
            sessionId,
            runId,
            taskId,
            runtimeId,
            connectionId,
            sequence,
            currency: 'EUR',
            costMinorUnits: 1n,
            computeUnits: 1n,
            taskPolicyVersion: 'bridge-test-v1',
            taskLimitMinorUnits: 100n,
            taskComputeLimit: 100n,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
    const firstConcurrent = concurrentWrite(0, true);
    await firstReady;
    const secondConcurrent = concurrentWrite(1, false);
    await new Promise((resolve) => setTimeout(resolve, 100));
    releaseFirst();
    await Promise.all([firstConcurrent, secondConcurrent]);
    expect(await prisma.acpRunUsage.count({ where: { workspaceId, dispatchId } })).toBe(4);
    const ledger = await prisma.acpCostLedgerEntry.findMany({
      where: { workspaceId, dispatchId },
      orderBy: { sequence: 'asc' },
    });
    expect(ledger).toHaveLength(4);
    expect(ledger.map((entry) => entry.workspaceSpendMinorUnits)).toEqual([5n, 7n, 8n, 9n]);
    expect(ledger.map((entry) => entry.taskSpendMinorUnits)).toEqual([5n, 7n, 8n, 9n]);
    expect(
      await new AcpCostLedgerQueryService().listLedger(capability, { workspaceId, principalId }),
    ).toHaveLength(4);
    const [workspaceCostPolicy, taskCostPolicy] = await Promise.all([
      prisma.acpCostBudgetPolicy.findUniqueOrThrow({
        where: {
          workspaceId_id: { workspaceId, id: `workspace-cost-policy-${suffix}` },
        },
      }),
      prisma.acpCostBudgetPolicy.findUniqueOrThrow({
        where: { workspaceId_id: { workspaceId, id: `task-cost-policy-${suffix}` } },
      }),
    ]);
    type RecordedAtSource = Date | ((receiptReceivedAt: Date) => Date);
    const forgedUsageLedger = (
      label: string,
      sequence: number,
      costMinorUnits: bigint,
      cumulativeCostMinorUnits: bigint,
      computeUnits: bigint,
      cumulativeComputeUnits: bigint,
      usageRecordedAt: RecordedAtSource,
      ledgerRecordedAt: RecordedAtSource,
      selectedWorkspacePolicy = workspaceCostPolicy,
      selectedTaskPolicy = taskCostPolicy,
      priorWorkspacePeriodSpend = 9n,
      priorTaskPeriodSpend = 9n,
      selectedRunId = runId,
      selectedDispatchId = dispatchId,
      selectedTaskId = taskId,
      selectedCurrency = 'EUR',
      beforeLedger?: () => void,
    ) =>
      prisma.$transaction(
        async (tx) => {
          const id = `forged-${label}-${suffix}`;
          const digest = 'd'.repeat(64);
          const createdReceipt = await tx.acpBridgeReceipt.create({
            data: {
              id,
              workspaceId,
              runtimeId,
              connectionId,
              sessionId,
              sequence,
              messageId: `forged-message-${label}-${suffix}`,
              messageType: 'USAGE',
              payloadDigest: digest,
              envelopeDigest: 'e'.repeat(64),
              taskId: selectedTaskId,
              runId: selectedRunId,
              dispatchId: selectedDispatchId,
              ...(usageRecordedAt instanceof Date ? { receivedAt: usageRecordedAt } : {}),
            },
          });
          const [persistedReceiptClock] = await tx.$queryRaw<Array<{ receivedAtIso: string }>>(
            Prisma.sql`SELECT to_char("receivedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "receivedAtIso" FROM "acp_bridge_receipts" WHERE "workspaceId" = ${workspaceId}::uuid AND "id" = ${createdReceipt.id}`,
          );
          const receipt = {
            ...createdReceipt,
            receivedAt: new Date(persistedReceiptClock!.receivedAtIso),
          };
          const resolvedUsageRecordedAt =
            usageRecordedAt instanceof Date ? usageRecordedAt : usageRecordedAt(receipt.receivedAt);
          const resolvedLedgerRecordedAt =
            ledgerRecordedAt instanceof Date
              ? ledgerRecordedAt
              : ledgerRecordedAt(receipt.receivedAt);
          const usageBindsReceipt =
            resolvedUsageRecordedAt.getTime() === receipt.receivedAt.getTime();
          const ledgerBindsReceipt =
            resolvedLedgerRecordedAt.getTime() === receipt.receivedAt.getTime();
          await tx.$executeRaw(
            Prisma.sql`INSERT INTO "acp_run_usages" ("id", "workspaceId", "dispatchId", "runId", "sessionId", "receiptId", "sequence", "computeUnits", "costMinorUnits", "cumulativeComputeUnits", "cumulativeCostMinorUnits", "currency", "evidenceHash", "recordedAt") SELECT ${id}, ${workspaceId}::uuid, ${selectedDispatchId}, ${selectedRunId}, ${sessionId}, ${id}, ${sequence}, ${computeUnits}, ${costMinorUnits}, ${cumulativeComputeUnits}, ${cumulativeCostMinorUnits}, ${selectedCurrency}, ${digest}, CASE WHEN ${usageBindsReceipt} THEN r."receivedAt" ELSE ${resolvedUsageRecordedAt}::timestamptz END FROM "acp_bridge_receipts" r WHERE r."workspaceId" = ${workspaceId}::uuid AND r."id" = ${id}`,
          );
          beforeLedger?.();
          await tx.$executeRaw(
            Prisma.sql`INSERT INTO "acp_cost_ledger_entries" ("id", "workspaceId", "usageId", "receiptId", "dispatchId", "sessionId", "runId", "taskId", "runtimeId", "connectionId", "sequence", "currency", "costMinorUnits", "computeUnits", "workspacePolicyId", "workspacePolicyHash", "taskPolicyId", "taskPolicyHash", "periodStart", "periodEnd", "workspaceSpendMinorUnits", "taskSpendMinorUnits", "checksum", "recordedAt") SELECT ${id}, ${workspaceId}::uuid, ${id}, ${id}, ${selectedDispatchId}, ${sessionId}, ${selectedRunId}, ${selectedTaskId}, ${runtimeId}, ${connectionId}, ${sequence}, ${selectedCurrency}, ${costMinorUnits}, ${computeUnits}, ${selectedWorkspacePolicy.id}, ${selectedWorkspacePolicy.policyHash}, ${selectedTaskPolicy.id}, ${selectedTaskPolicy.policyHash}, ${selectedWorkspacePolicy.periodStart}, ${selectedWorkspacePolicy.periodEnd}, ${priorWorkspacePeriodSpend + costMinorUnits}, ${priorTaskPeriodSpend + costMinorUnits}, ${'f'.repeat(64)}, CASE WHEN ${ledgerBindsReceipt} THEN r."receivedAt" ELSE ${resolvedLedgerRecordedAt}::timestamptz END FROM "acp_bridge_receipts" r WHERE r."workspaceId" = ${workspaceId}::uuid AND r."id" = ${id}`,
          );
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 },
      );
    const futurePeriodStart = workspaceCostPolicy.periodEnd;
    const futurePeriodEnd = new Date(futurePeriodStart.getTime() + 86_400_000);
    const futureWorkspacePolicyInput = {
      schemaVersion: 1 as const,
      policyId: `workspace-cost-policy-future-${suffix}`,
      workspaceId,
      scope: 'WORKSPACE' as const,
      taskId: null,
      currency: 'EUR',
      limitMinorUnits: 250n,
      periodStart: futurePeriodStart.toISOString(),
      periodEnd: futurePeriodEnd.toISOString(),
      policyVersion: 'bridge-test-v1',
    };
    const primaryRun = await prisma.acpRun.findUniqueOrThrow({
      where: { workspaceId_id: { workspaceId, id: runId } },
    });
    const primaryTask = await prisma.acpTask.findUniqueOrThrow({
      where: { workspaceId_id: { workspaceId, id: taskId } },
    });
    const lifetimeTaskId = `lifetime-task-${suffix}`;
    const lifetimeAgentId = primaryRun.assignedAgentId!;
    await prisma.acpTask.create({
      data: {
        id: lifetimeTaskId,
        workspaceId,
        objectiveId: primaryTask.objectiveId,
        projectId: primaryTask.projectId,
        title: 'Lifetime retry fixture',
        kind: primaryTask.kind,
        status: 'RUNNING',
        requiredAuthority: primaryTask.requiredAuthority,
        currency: primaryTask.currency,
        maximumCostMinorUnits: 100n,
        maximumComputeUnits: 100n,
        estimatedDurationMs: primaryTask.estimatedDurationMs,
        acceptanceCriteria: primaryTask.acceptanceCriteria,
        verificationCriteria: primaryTask.verificationCriteria,
        stopConditions: primaryTask.stopConditions,
        maximumAttempts: 3,
        retryableFailureCodes: primaryTask.retryableFailureCodes,
        stopAfterFailureCodes: primaryTask.stopAfterFailureCodes,
        agentPolicy: primaryTask.agentPolicy as Prisma.InputJsonValue,
        routingPolicy: primaryTask.routingPolicy as Prisma.InputJsonValue,
        exactTarget: primaryTask.exactTarget,
        approvalActionCode: primaryTask.approvalActionCode,
        approvalArtifactVersion: primaryTask.approvalArtifactVersion,
        approvalEvidenceHash: primaryTask.approvalEvidenceHash,
        policyVersion: primaryTask.policyVersion,
        policyHash: primaryTask.policyHash,
        assignedAgentId: lifetimeAgentId,
        assignedRuntimeId: runtimeId,
        assignedConnectionId: connectionId,
        attempt: 1,
      },
    });
    const currentLifetimeTaskPolicyInput = {
      schemaVersion: 1 as const,
      policyId: `task-cost-policy-lifetime-current-${suffix}`,
      workspaceId,
      scope: 'TASK' as const,
      taskId: lifetimeTaskId,
      currency: 'EUR',
      limitMinorUnits: 100n,
      periodStart: workspaceCostPolicy.periodStart.toISOString(),
      periodEnd: workspaceCostPolicy.periodEnd.toISOString(),
      policyVersion: 'bridge-test-v1',
    };
    const futureTaskPolicyInput = {
      ...futureWorkspacePolicyInput,
      policyId: `task-cost-policy-lifetime-future-${suffix}`,
      scope: 'TASK' as const,
      taskId: lifetimeTaskId,
      limitMinorUnits: 100n,
    };
    await prisma.acpCostBudgetPolicy.createMany({
      data: [futureWorkspacePolicyInput, currentLifetimeTaskPolicyInput, futureTaskPolicyInput].map(
        (input) => {
          const {
            schemaVersion: _schemaVersion,
            policyId: id,
            periodStart,
            periodEnd,
            ...policy
          } = input;
          return {
            ...policy,
            id,
            periodStart: new Date(periodStart),
            periodEnd: new Date(periodEnd),
            policyHash: costBudgetPolicyHash(input),
          };
        },
      ),
    });
    const [futureWorkspacePolicy, currentLifetimeTaskPolicy, futureTaskPolicy] = await Promise.all([
      prisma.acpCostBudgetPolicy.findUniqueOrThrow({
        where: { workspaceId_id: { workspaceId, id: futureWorkspacePolicyInput.policyId } },
      }),
      prisma.acpCostBudgetPolicy.findUniqueOrThrow({
        where: {
          workspaceId_id: { workspaceId, id: currentLifetimeTaskPolicyInput.policyId },
        },
      }),
      prisma.acpCostBudgetPolicy.findUniqueOrThrow({
        where: { workspaceId_id: { workspaceId, id: futureTaskPolicyInput.policyId } },
      }),
    ]);
    const createAcceptedLifetimeRun = async (
      label: string,
      attempt: number,
      selectedTaskId = lifetimeTaskId,
    ) => {
      const selectedRunId = `lifetime-${label}-run-${suffix}`;
      const selectedDispatchId = `lifetime-${label}-dispatch-${suffix}`;
      const reservationId = `lifetime-${label}-reservation-${suffix}`;
      const evidenceId = `lifetime-${label}-assignment-${suffix}`;
      const evidenceHash = label === 'old' ? '1'.repeat(64) : '7'.repeat(64);
      const reservationHash = label === 'old' ? '2'.repeat(64) : '8'.repeat(64);
      await prisma.acpRun.create({
        data: {
          id: selectedRunId,
          workspaceId,
          objectiveId: primaryRun.objectiveId,
          taskId: selectedTaskId,
          status: 'RUNNING',
          requiredAuthority: primaryRun.requiredAuthority,
          policyVersion: primaryRun.policyVersion,
          policyHash: primaryRun.policyHash,
          actionCode: primaryRun.actionCode,
          exactTarget: primaryRun.exactTarget,
          artifactVersionId: primaryRun.artifactVersionId,
          evidenceHash: primaryRun.evidenceHash,
          assignedAgentId: lifetimeAgentId,
          assignedRuntimeId: runtimeId,
          assignedConnectionId: connectionId,
          assignmentEvidenceId: evidenceId,
          assignmentEvidenceHash: evidenceHash,
          assignmentIdempotencyKey: `lifetime-${label}-assignment-${suffix}`,
          attempt,
          version: 1,
          idempotencyKey: `lifetime-${label}-run-${suffix}`,
          startedAt: new Date(),
        },
      });
      await prisma.acpBrokerReservation.create({
        data: {
          id: reservationId,
          workspaceId,
          objectiveId: primaryRun.objectiveId,
          taskId: selectedTaskId,
          runId: selectedRunId,
          agentId: lifetimeAgentId,
          agentEvidenceId: `lifetime-${label}-agent-evidence-${suffix}`,
          agentEvidenceHash: '3'.repeat(64),
          runtimeId,
          connectionId,
          requestHash: '4'.repeat(64),
          candidateEvidenceId: `lifetime-${label}-candidates-${suffix}`,
          candidateEvidenceHash: '5'.repeat(64),
          taskPolicyHash: primaryRun.policyHash,
          taskPolicyVersion: primaryRun.policyVersion,
          expectedRunVersion: 1,
          selectedScoreBps: 9_000,
          estimatedCostMinorUnits: 92n,
          reservedComputeUnits: 92n,
          maxConcurrentRuns: 10,
          evidenceHash: reservationHash,
          state: 'RESERVED',
          testOnly: true,
          idempotencyKey: `lifetime-${label}-reservation-${suffix}`,
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      await prisma.acpBridgeDispatch.create({
        data: {
          id: selectedDispatchId,
          workspaceId,
          objectiveId: primaryRun.objectiveId,
          taskId: selectedTaskId,
          runId: selectedRunId,
          runtimeId,
          connectionId,
          sessionId,
          agentId: lifetimeAgentId,
          authorityLevel: primaryRun.requiredAuthority,
          state: 'PREPARED',
          brokerEvidenceId: reservationId,
          brokerEvidenceHash: reservationHash,
          assignmentEvidenceId: evidenceId,
          assignmentEvidenceHash: evidenceHash,
          dispatchEnvelopeHash: '6'.repeat(64),
          idempotencyKey: `lifetime-${label}-dispatch-${suffix}`,
        },
      });
      await prisma.acpBridgeDispatch.update({
        where: { workspaceId_id: { workspaceId, id: selectedDispatchId } },
        data: { state: 'ACCEPTED', acceptedAt: new Date() },
      });
      return { runId: selectedRunId, dispatchId: selectedDispatchId };
    };
    const hostileTimezoneReceiptId = `hostile-timezone-receipt-${suffix}`;
    const hostileTimezoneObservation = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SET LOCAL TIME ZONE 'Pacific/Kiritimati'`);
      await tx.acpBridgeReceipt.create({
        data: {
          id: hostileTimezoneReceiptId,
          workspaceId,
          runtimeId,
          connectionId,
          sessionId,
          sequence: 1_107,
          messageId: `hostile-timezone-message-${suffix}`,
          messageType: 'USAGE',
          payloadDigest: 'a'.repeat(64),
          envelopeDigest: 'b'.repeat(64),
          taskId,
          runId,
          dispatchId,
          receivedAt: new Date('2000-01-01T00:00:00.000Z'),
        },
      });
      const [persisted] = await tx.$queryRaw<Array<{ receivedAtIso: string }>>(
        Prisma.sql`SELECT to_char("receivedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "receivedAtIso" FROM "acp_bridge_receipts" WHERE "workspaceId" = ${workspaceId}::uuid AND "id" = ${hostileTimezoneReceiptId}`,
      );
      const [clock] = await tx.$queryRaw<Array<{ observedAtIso: string }>>(
        Prisma.sql`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "observedAtIso"`,
      );
      await tx.acpBridgeReceipt.delete({
        where: { workspaceId_id: { workspaceId, id: hostileTimezoneReceiptId } },
      });
      return {
        persistedAt: new Date(persisted!.receivedAtIso),
        observedAt: new Date(clock!.observedAtIso),
      };
    });
    expect(
      Math.abs(
        hostileTimezoneObservation.persistedAt.getTime() -
          hostileTimezoneObservation.observedAt.getTime(),
      ),
    ).toBeLessThan(2_000);

    const rolloverTaskId = `rollover-task-${suffix}`;
    await prisma.acpTask.create({
      data: {
        id: rolloverTaskId,
        workspaceId,
        objectiveId: primaryTask.objectiveId,
        projectId: primaryTask.projectId,
        title: 'Policy rollover lock fixture',
        kind: primaryTask.kind,
        status: 'RUNNING',
        requiredAuthority: primaryTask.requiredAuthority,
        currency: 'USD',
        maximumCostMinorUnits: 100n,
        maximumComputeUnits: 100n,
        estimatedDurationMs: primaryTask.estimatedDurationMs,
        acceptanceCriteria: primaryTask.acceptanceCriteria,
        verificationCriteria: primaryTask.verificationCriteria,
        stopConditions: primaryTask.stopConditions,
        maximumAttempts: 1,
        retryableFailureCodes: primaryTask.retryableFailureCodes,
        stopAfterFailureCodes: primaryTask.stopAfterFailureCodes,
        agentPolicy: primaryTask.agentPolicy as Prisma.InputJsonValue,
        routingPolicy: primaryTask.routingPolicy as Prisma.InputJsonValue,
        exactTarget: primaryTask.exactTarget,
        approvalActionCode: primaryTask.approvalActionCode,
        approvalArtifactVersion: primaryTask.approvalArtifactVersion,
        approvalEvidenceHash: primaryTask.approvalEvidenceHash,
        policyVersion: primaryTask.policyVersion,
        policyHash: primaryTask.policyHash,
        assignedAgentId: lifetimeAgentId,
        assignedRuntimeId: runtimeId,
        assignedConnectionId: connectionId,
        attempt: 1,
      },
    });
    const rolloverRun = await createAcceptedLifetimeRun('rollover', 1, rolloverTaskId);
    const [rolloverClock] = await prisma.$queryRaw<Array<{ observedAt: Date }>>(
      Prisma.sql`SELECT clock_timestamp() AS "observedAt"`,
    );
    const rolloverPeriodStart = new Date(rolloverClock!.observedAt.getTime() - 1_000);
    const rolloverPeriodEnd = new Date(rolloverClock!.observedAt.getTime() + 2_000);
    const rolloverWorkspacePolicyInput = {
      schemaVersion: 1 as const,
      policyId: `workspace-cost-policy-rollover-${suffix}`,
      workspaceId,
      scope: 'WORKSPACE' as const,
      taskId: null,
      currency: 'USD',
      limitMinorUnits: 100n,
      periodStart: rolloverPeriodStart.toISOString(),
      periodEnd: rolloverPeriodEnd.toISOString(),
      policyVersion: 'bridge-test-v1',
    };
    const rolloverTaskPolicyInput = {
      ...rolloverWorkspacePolicyInput,
      policyId: `task-cost-policy-rollover-${suffix}`,
      scope: 'TASK' as const,
      taskId: rolloverTaskId,
    };
    await prisma.acpCostBudgetPolicy.createMany({
      data: [rolloverWorkspacePolicyInput, rolloverTaskPolicyInput].map((input) => {
        const { schemaVersion: _schemaVersion, policyId: id, ...policy } = input;
        return { ...policy, id, policyHash: costBudgetPolicyHash(input) };
      }),
    });
    const [rolloverWorkspacePolicy, rolloverTaskPolicy] = await Promise.all([
      prisma.acpCostBudgetPolicy.findUniqueOrThrow({
        where: {
          workspaceId_id: { workspaceId, id: rolloverWorkspacePolicyInput.policyId },
        },
      }),
      prisma.acpCostBudgetPolicy.findUniqueOrThrow({
        where: { workspaceId_id: { workspaceId, id: rolloverTaskPolicyInput.policyId } },
      }),
    ]);
    let releaseRolloverPolicyLock!: () => void;
    let reportRolloverPolicyLocked!: () => void;
    const rolloverPolicyLockReleased = new Promise<void>((resolve) => {
      releaseRolloverPolicyLock = resolve;
    });
    const rolloverPolicyLocked = new Promise<void>((resolve) => {
      reportRolloverPolicyLocked = resolve;
    });
    const rolloverPolicyBlocker = prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "acp_cost_budget_policies" WHERE "workspaceId" = ${workspaceId}::uuid AND "id" = ${rolloverWorkspacePolicy.id} FOR UPDATE`,
      );
      reportRolloverPolicyLocked();
      await rolloverPolicyLockReleased;
    });
    await rolloverPolicyLocked;
    let reportRolloverWriteReady!: () => void;
    const rolloverWriteReady = new Promise<void>((resolve) => {
      reportRolloverWriteReady = resolve;
    });
    const rolloverWriteId = `forged-lock-rollover-${suffix}`;
    const rolloverWriteOutcome = forgedUsageLedger(
      'lock-rollover',
      1_108,
      1n,
      1n,
      1n,
      1n,
      (receivedAt) => receivedAt,
      (receivedAt) => receivedAt,
      rolloverWorkspacePolicy,
      rolloverTaskPolicy,
      0n,
      0n,
      rolloverRun.runId,
      rolloverRun.dispatchId,
      rolloverTaskId,
      'USD',
      reportRolloverWriteReady,
    ).then(
      () => null,
      (error: unknown) => error,
    );
    try {
      await rolloverWriteReady;
      let periodExpired = false;
      const waitDeadline = Date.now() + 6_000;
      while (!periodExpired && Date.now() < waitDeadline) {
        const [state] = await prisma.$queryRaw<Array<{ expired: boolean }>>(
          Prisma.sql`SELECT clock_timestamp() >= ${rolloverPeriodEnd} AS "expired"`,
        );
        periodExpired = state!.expired;
        if (!periodExpired) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(periodExpired).toBe(true);
    } finally {
      releaseRolloverPolicyLock();
      await rolloverPolicyBlocker;
    }
    expect(String(await rolloverWriteOutcome)).toMatch(
      /cost budget policy expired before ledger commit/iu,
    );
    expect(
      await prisma.acpBridgeReceipt.count({ where: { workspaceId, id: rolloverWriteId } }),
    ).toBe(0);
    expect(await prisma.acpRunUsage.count({ where: { workspaceId, id: rolloverWriteId } })).toBe(0);
    expect(
      await prisma.acpCostLedgerEntry.count({ where: { workspaceId, id: rolloverWriteId } }),
    ).toBe(0);
    await prisma.acpBridgeDispatch.update({
      where: { workspaceId_id: { workspaceId, id: rolloverRun.dispatchId } },
      data: { state: 'FAILED', terminalAt: new Date() },
    });
    await prisma.acpRun.update({
      where: { workspaceId_id: { workspaceId, id: rolloverRun.runId } },
      data: { status: 'FAILED', version: 2, completedAt: new Date() },
    });
    const oldLifetimeRun = await createAcceptedLifetimeRun('old', 1);
    await forgedUsageLedger(
      'lifetime-old-run',
      1_101,
      9n,
      9n,
      14n,
      14n,
      (receivedAt) => receivedAt,
      (receivedAt) => receivedAt,
      workspaceCostPolicy,
      currentLifetimeTaskPolicy,
      9n,
      0n,
      oldLifetimeRun.runId,
      oldLifetimeRun.dispatchId,
      lifetimeTaskId,
    );
    await prisma.acpBridgeDispatch.update({
      where: { workspaceId_id: { workspaceId, id: oldLifetimeRun.dispatchId } },
      data: { state: 'COMPLETED', terminalAt: new Date() },
    });
    await prisma.acpRun.update({
      where: { workspaceId_id: { workspaceId, id: oldLifetimeRun.runId } },
      data: { status: 'FAILED', version: 2, completedAt: new Date() },
    });
    const retryLifetimeRun = await createAcceptedLifetimeRun('retry', 2);
    const rejectedLifetimeId = `forged-lifetime-budget-${suffix}`;
    const auditBeforeLifetimeDenial = await prisma.auditEvent.count({
      where: { workspaceReference: workspaceId },
    });
    await expect(
      forgedUsageLedger(
        'lifetime-budget',
        1_102,
        92n,
        92n,
        92n,
        92n,
        (receivedAt) => receivedAt,
        (receivedAt) => receivedAt,
        workspaceCostPolicy,
        currentLifetimeTaskPolicy,
        18n,
        9n,
        retryLifetimeRun.runId,
        retryLifetimeRun.dispatchId,
        lifetimeTaskId,
      ),
    ).rejects.toThrow(/task durable budget correlation mismatch/iu);
    expect(
      await prisma.acpBridgeReceipt.count({ where: { workspaceId, id: rejectedLifetimeId } }),
    ).toBe(0);
    expect(await prisma.acpRunUsage.count({ where: { workspaceId, id: rejectedLifetimeId } })).toBe(
      0,
    );
    expect(
      await prisma.acpCostLedgerEntry.count({ where: { workspaceId, id: rejectedLifetimeId } }),
    ).toBe(0);
    expect(await prisma.auditEvent.count({ where: { workspaceReference: workspaceId } })).toBe(
      auditBeforeLifetimeDenial,
    );
    await prisma.acpBridgeDispatch.update({
      where: { workspaceId_id: { workspaceId, id: retryLifetimeRun.dispatchId } },
      data: { state: 'FAILED', terminalAt: new Date() },
    });
    await prisma.acpRun.update({
      where: { workspaceId_id: { workspaceId, id: retryLifetimeRun.runId } },
      data: { status: 'FAILED', version: 2, completedAt: new Date() },
    });
    expect(
      (
        await prisma.acpBrokerReservation.findFirstOrThrow({
          where: { workspaceId, runId: retryLifetimeRun.runId },
        })
      ).state,
    ).toBe('RELEASED');
    const futurePolicyRun = await createAcceptedLifetimeRun('future-policy', 3);
    const rejectedFuturePolicyId = `forged-future-period-clock-${suffix}`;
    const auditBeforeFuturePolicyDenial = await prisma.auditEvent.count({
      where: { workspaceReference: workspaceId },
    });
    await expect(
      forgedUsageLedger(
        'future-period-clock',
        1_106,
        1n,
        1n,
        1n,
        1n,
        (receivedAt) => receivedAt,
        (receivedAt) => receivedAt,
        futureWorkspacePolicy,
        futureTaskPolicy,
        0n,
        0n,
        futurePolicyRun.runId,
        futurePolicyRun.dispatchId,
        lifetimeTaskId,
      ),
    ).rejects.toThrow(/workspace budget policy correlation mismatch/iu);
    expect(
      await prisma.acpBridgeReceipt.count({
        where: { workspaceId, id: rejectedFuturePolicyId },
      }),
    ).toBe(0);
    expect(
      await prisma.acpRunUsage.count({ where: { workspaceId, id: rejectedFuturePolicyId } }),
    ).toBe(0);
    expect(
      await prisma.acpCostLedgerEntry.count({
        where: { workspaceId, id: rejectedFuturePolicyId },
      }),
    ).toBe(0);
    expect(await prisma.auditEvent.count({ where: { workspaceReference: workspaceId } })).toBe(
      auditBeforeFuturePolicyDenial,
    );
    await prisma.acpBridgeDispatch.update({
      where: { workspaceId_id: { workspaceId, id: futurePolicyRun.dispatchId } },
      data: { state: 'FAILED', terminalAt: new Date() },
    });
    await prisma.acpRun.update({
      where: { workspaceId_id: { workspaceId, id: futurePolicyRun.runId } },
      data: { status: 'FAILED', version: 2, completedAt: new Date() },
    });
    expect(
      (
        await prisma.acpBrokerReservation.findFirstOrThrow({
          where: { workspaceId, runId: futurePolicyRun.runId },
        })
      ).state,
    ).toBe('RELEASED');
    await expect(
      prisma.acpCostLedgerEntry.delete({
        where: { workspaceId_id: { workspaceId, id: cumulativeUsage.id } },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.acpRunUsage.delete({
        where: { workspaceId_id: { workspaceId, id: cumulativeUsage.id } },
      }),
    ).rejects.toThrow(/only be removed during workspace erasure/iu);
    await expect(
      prisma.acpBridgeReceipt.delete({
        where: { workspaceId_id: { workspaceId, id: cumulativeUsage.receiptId } },
      }),
    ).rejects.toThrow(/only be removed during workspace erasure/iu);
    expect(
      await prisma.acpCostLedgerEntry.count({
        where: { workspaceId, usageId: cumulativeUsage.id },
      }),
    ).toBe(1);
    const costAudit = await prisma.auditEvent.findFirstOrThrow({
      where: {
        workspaceReference: workspaceId,
        source: 'CONTROL_PLANE',
        action: 'cost.ledger.recorded',
        entityType: 'AcpCostLedgerEntry',
        entityId: cumulativeUsage.id,
      },
    });
    expect(costAudit.after).toMatchObject({
      workspaceCostUsedMinorUnits: 7,
      workspaceCostLimitMinorUnits: 250,
      workspacePolicyId: `workspace-cost-policy-${suffix}`,
      usageId: cumulativeUsage.id,
      receiptId: cumulativeUsage.id,
    });

    let releaseTaskLock!: () => void;
    let reportTaskLocked!: () => void;
    const taskLockReleased = new Promise<void>((resolve) => {
      releaseTaskLock = resolve;
    });
    const taskLocked = new Promise<void>((resolve) => {
      reportTaskLocked = resolve;
    });
    const taskBlocker = prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "acp_tasks" WHERE "workspaceId" = ${workspaceId}::uuid AND "id" = ${taskId} FOR UPDATE`,
      );
      reportTaskLocked();
      await taskLockReleased;
    });
    await taskLocked;
    const bridgePath = bridge.acceptRuntimeMessage(
      capability,
      { workspaceId, principalId },
      fake.emit('USAGE', {
        dispatchId,
        taskId,
        runId,
        computeUnits: 1,
        costMinorUnits: 1,
        currency: 'EUR',
      }),
    );
    const directPath = prisma.$transaction(
      (tx) =>
        costGovernance.recordUsage(capability, { workspaceId, principalId }, 'SYSTEM', tx, {
          usageId: `missing-lock-order-usage-${suffix}`,
          receiptId: `missing-lock-order-receipt-${suffix}`,
          dispatchId,
          sessionId,
          runId,
          taskId,
          runtimeId,
          connectionId,
          sequence: 2_000,
          currency: 'EUR',
          costMinorUnits: 1n,
          computeUnits: 1n,
          taskPolicyVersion: 'bridge-test-v1',
          taskLimitMinorUnits: 100n,
          taskComputeLimit: 100n,
        }),
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
    const directOutcome = directPath.then(
      () => null,
      (error: unknown) => error,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    await expect(
      prisma.$transaction((tx) =>
        tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "acp_cost_budget_policies" WHERE "workspaceId" = ${workspaceId}::uuid AND "id" IN (${workspaceCostPolicy.id}, ${taskCostPolicy.id}) FOR UPDATE NOWAIT`,
        ),
      ),
    ).resolves.toBeDefined();
    releaseTaskLock();
    await taskBlocker;
    expect(await directOutcome).toBeInstanceOf(Error);
    await expect(bridgePath).resolves.toBeDefined();

    await bridge.acceptRuntimeMessage(
      capability,
      { workspaceId, principalId },
      fake.emit('RESULT', { dispatchId, resultCode: 'SUCCESS' }),
    );
    expect(
      (
        await prisma.acpBrokerReservation.findUniqueOrThrow({
          where: { workspaceId_id: { workspaceId, id: routed.reservation.id } },
        })
      ).state,
    ).toBe('RELEASED');
    await expect(
      brokerReservations.reserveForPreparedRun(
        capability,
        { workspaceId, principalId },
        {
          reservationId: `broker-${suffix}`,
          runId,
          agentId: `fixture-agent-${suffix}`,
          expectedRunVersion: 1,
          idempotencyKey: `broker-${suffix}`,
        },
      ),
    ).rejects.toThrow(/replay is inactive/iu);
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

    const receiptCountBeforeCancellationFlow = await prisma.acpBridgeReceipt.count({
      where: { workspaceId, sessionId },
    });
    const cancelDispatchId = `cancel-dispatch-${suffix}`;
    refreshCandidateSnapshot();
    const cancelRouted = await brokerReservations.reserveForPreparedRun(
      capability,
      { workspaceId, principalId },
      {
        reservationId: `cancel-broker-${suffix}`,
        runId: cancelRunId,
        agentId: `fixture-agent-${suffix}`,
        expectedRunVersion: 1,
        idempotencyKey: `cancel-broker-${suffix}`,
      },
    );
    const cancelPrepared = await bridge.prepareDispatch(
      capability,
      { workspaceId, principalId },
      {
        dispatchId: cancelDispatchId,
        agentId: `fixture-agent-${suffix}`,
        sessionId,
        idempotencyKey: `cancel-dispatch-idempotency-${suffix}`,
        brokerEvidence: {
          evidenceId: cancelRouted.reservation.id,
          evidenceHash: cancelRouted.reservation.evidenceHash,
          workspaceId,
          taskId: cancelTaskId,
          runId: cancelRunId,
          agentId: `fixture-agent-${suffix}`,
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
        evidenceId: cancelPrepared.dispatch.assignmentEvidenceId,
        assignmentEvidenceHash: cancelPrepared.dispatch.assignmentEvidenceHash,
      }),
    );
    const cancelAssigned = await taskRuns.reserveAssignment(
      capability,
      { workspaceId, principalId },
      {
        evidenceId: cancelPrepared.dispatch.assignmentEvidenceId,
        evidenceHash: cancelPrepared.dispatch.assignmentEvidenceHash,
        taskId: cancelTaskId,
        runId: cancelRunId,
        agentId: `fixture-agent-${suffix}`,
        runtimeId,
        connectionId,
      },
      1,
      `cancel-reserve-${suffix}`,
    );
    await taskRuns.startRun(
      capability,
      { workspaceId, principalId },
      cancelRunId,
      cancelAssigned.run.version,
      `cancel-start-${suffix}`,
    );
    const cancellation = await bridge.requestCancellation(
      capability,
      { workspaceId, principalId },
      cancelDispatchId,
      `cancel-${suffix}`,
    );
    expect(cancellation.dispatch.state).toBe('CANCEL_REQUESTED');
    const cancelSequence = (
      await prisma.acpBridgeSession.findUniqueOrThrow({
        where: { workspaceId_id: { workspaceId, id: sessionId } },
      })
    ).expectedSequence;
    const cancellationReceiptCount = await prisma.acpBridgeReceipt.count({
      where: { workspaceId, sessionId },
    });
    const cancellationAuditCount = await prisma.auditEvent.count({
      where: { workspaceReference: workspaceId },
    });
    for (const [type, payload] of [
      ['PROGRESS', { dispatchId: cancelDispatchId, progressCode: 'TOO_LATE' }],
      [
        'ARTIFACT',
        {
          dispatchId: cancelDispatchId,
          taskId: cancelTaskId,
          runId: cancelRunId,
          evidenceId: `cancel-late-evidence-${suffix}`,
          evidenceHash: '6'.repeat(64),
          artifactId: `cancel-late-artifact-${suffix}`,
          criterion: 'cancel-evidence',
          kind: 'TEST_EVIDENCE',
          uriReference: `artifact://fixture/cancel-late/${suffix}`,
          contentHash: '7'.repeat(64),
        },
      ],
      [
        'USAGE',
        {
          dispatchId: cancelDispatchId,
          taskId: cancelTaskId,
          runId: cancelRunId,
          computeUnits: 1,
          costMinorUnits: 1,
          currency: 'EUR',
        },
      ],
      ['RESULT', { dispatchId: cancelDispatchId, resultCode: 'IGNORED' }],
      ['FAILED', { dispatchId: cancelDispatchId, resultCode: 'IGNORED' }],
    ] as const) {
      await expect(
        bridge.acceptRuntimeMessage(
          capability,
          { workspaceId, principalId },
          fake.emitAt(cancelSequence, type, payload),
        ),
      ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    }
    expect(await prisma.acpBridgeReceipt.count({ where: { workspaceId, sessionId } })).toBe(
      cancellationReceiptCount,
    );
    expect(await prisma.auditEvent.count({ where: { workspaceReference: workspaceId } })).toBe(
      cancellationAuditCount,
    );
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
    expect(
      (
        await prisma.acpBrokerReservation.findUniqueOrThrow({
          where: { workspaceId_id: { workspaceId, id: cancelRouted.reservation.id } },
        })
      ).state,
    ).toBe('RELEASED');

    expect(await prisma.acpBridgeReceipt.count({ where: { workspaceId, sessionId } })).toBe(
      receiptCountBeforeCancellationFlow + 2,
    );
    expect(
      (
        await prisma.acpBridgeDispatch.findUniqueOrThrow({
          where: { workspaceId_id: { workspaceId, id: dispatchId } },
        })
      ).state,
    ).toBe('COMPLETED');
    const usage = await prisma.acpRunUsage.findFirstOrThrow({ where: { workspaceId, runId } });
    expect(
      await prisma.auditEvent.findFirst({
        where: {
          workspaceReference: workspaceId,
          source: 'CONTROL_PLANE',
          idempotencyKey: `bridge-receipt:${usage.receiptId}`,
          entityType: 'AcpRunUsage',
          entityId: usage.id,
        },
      }),
    ).not.toBeNull();
    const runtime = await prisma.acpRuntime.findUniqueOrThrow({
      where: { workspaceId_id: { workspaceId, id: runtimeId } },
    });
    expect(runtime.secretReference).toBe(secretReference);
    expect(runtime.secretDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(runtime)).not.toContain(secret.toString('utf8'));
  });

  it('atomically admits a bounded authenticated JSONL batch from the durable checkpoint', async () => {
    const batchSessionId = `batch-session-${suffix}`;
    const batchParentNonce = `batch_parent_${suffix.replaceAll('-', '')}`;
    const batchRuntimeNonce = `batch_runtime_${suffix.replaceAll('-', '')}`;
    const openedAt = new Date();
    await bridge.openSession(
      capability,
      { workspaceId, principalId },
      {
        sessionId: batchSessionId,
        connectionId,
        parentNonce: batchParentNonce,
        expiresAt: new Date(openedAt.getTime() + 240_000).toISOString(),
      },
    );
    const batchRuntime = new DeterministicFakeRuntime(
      {
        workspaceId,
        runtimeId,
        connectionId,
        sessionId: batchSessionId,
        principalReference: `fixture-principal-${suffix}`,
        parentNonce: batchParentNonce,
        runtimeNonce: batchRuntimeNonce,
      },
      secret,
      openedAt,
    );
    await bridge.authenticateSession(
      capability,
      { workspaceId, principalId },
      batchRuntime.emit('AUTHENTICATE', {
        parentNonce: batchParentNonce,
        runtimeNonce: batchRuntimeNonce,
      }),
    );
    const capabilityFrame = batchRuntime.emit('CAPABILITIES', {
      capabilityCodes: ['health.read', 'quality.verify'],
    });
    const heartbeatFrame = batchRuntime.emit('HEARTBEAT', { health: 'HEALTHY' });
    const leaseCount = secretLeaseRequests.length;
    const bytes = Buffer.concat([
      encodeBridgeLine(capabilityFrame),
      encodeBridgeLine(heartbeatFrame),
    ]);
    const raced = await Promise.allSettled([
      bridge.acceptAuthenticatedBatch(
        capability,
        { workspaceId, principalId },
        {
          sessionId: batchSessionId,
          bytes,
        },
      ),
      bridge.acceptAuthenticatedBatch(
        capability,
        { workspaceId, principalId },
        {
          sessionId: batchSessionId,
          bytes,
        },
      ),
    ]);
    expect(raced.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(raced.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const receipts = raced.find((result) => result.status === 'fulfilled')!.value;
    expect(receipts.map((receipt) => receipt.sequence)).toEqual([2, 3]);
    expect(secretLeaseRequests.slice(leaseCount)).toEqual([
      expect.objectContaining({
        workspaceId,
        runtimeId,
        connectionId,
        secretReference,
        authGeneration: 1,
        purpose: 'VERIFY_FRAME',
      }),
    ]);
    const durableSession = await prisma.acpBridgeSession.findUniqueOrThrow({
      where: { workspaceId_id: { workspaceId, id: batchSessionId } },
      include: { connection: true },
    });
    expect(durableSession.state).toBe('PARTIAL');
    expect(durableSession.expectedSequence).toBe(4);
    expect(durableSession.connection.status).toBe('PARTIAL');
    expect(
      (
        await prisma.acpRuntime.findUniqueOrThrow({
          where: { workspaceId_id: { workspaceId, id: runtimeId } },
        })
      ).status,
    ).toBe('NOT_CONFIGURED');
  });

  it('rolls back an earlier valid frame when a later batch frame fails policy', async () => {
    const rollbackSessionId = `batch-rollback-${suffix}`;
    const parentNonce = `rollback_parent_${suffix.replaceAll('-', '')}`;
    const runtimeNonce = `rollback_runtime_${suffix.replaceAll('-', '')}`;
    const openedAt = new Date();
    await bridge.openSession(
      capability,
      { workspaceId, principalId },
      {
        sessionId: rollbackSessionId,
        connectionId,
        parentNonce,
        expiresAt: new Date(openedAt.getTime() + 240_000).toISOString(),
      },
    );
    const runtime = new DeterministicFakeRuntime(
      {
        workspaceId,
        runtimeId,
        connectionId,
        sessionId: rollbackSessionId,
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
      runtime.emit('AUTHENTICATE', { parentNonce, runtimeNonce }),
    );
    const leaseCountBeforeMalformed = secretLeaseRequests.length;
    await expect(
      bridge.acceptAuthenticatedBatch(
        capability,
        { workspaceId, principalId },
        {
          sessionId: `missing-batch-${suffix}`,
          bytes: Buffer.from('{"incomplete":true}', 'utf8'),
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    expect(secretLeaseRequests).toHaveLength(leaseCountBeforeMalformed);

    const gapRuntime = new DeterministicFakeRuntime(
      {
        workspaceId,
        runtimeId,
        connectionId,
        sessionId: rollbackSessionId,
        principalReference: `fixture-principal-${suffix}`,
        parentNonce,
        runtimeNonce,
      },
      secret,
      openedAt,
    );
    gapRuntime.emit('AUTHENTICATE', { parentNonce, runtimeNonce });
    gapRuntime.emit('CAPABILITIES', {
      capabilityCodes: ['health.read', 'quality.verify'],
    });
    await expect(
      bridge.acceptAuthenticatedBatch(
        capability,
        { workspaceId, principalId },
        {
          sessionId: rollbackSessionId,
          bytes: encodeBridgeLine(gapRuntime.emit('HEARTBEAT', { health: 'HEALTHY' })),
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionConflictError);
    expect(secretLeaseRequests).toHaveLength(leaseCountBeforeMalformed);

    const orderingRuntime = new DeterministicFakeRuntime(
      {
        workspaceId,
        runtimeId,
        connectionId,
        sessionId: rollbackSessionId,
        principalReference: `fixture-principal-${suffix}`,
        parentNonce,
        runtimeNonce,
      },
      secret,
      openedAt,
    );
    orderingRuntime.emit('AUTHENTICATE', { parentNonce, runtimeNonce });
    await expect(
      bridge.acceptAuthenticatedBatch(
        capability,
        { workspaceId, principalId },
        {
          sessionId: rollbackSessionId,
          bytes: encodeBridgeLine(orderingRuntime.emit('HEARTBEAT', { health: 'HEALTHY' })),
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    expect(secretLeaseRequests).toHaveLength(leaseCountBeforeMalformed);

    const duplicateCapabilityRuntime = new DeterministicFakeRuntime(
      {
        workspaceId,
        runtimeId,
        connectionId,
        sessionId: rollbackSessionId,
        principalReference: `fixture-principal-${suffix}`,
        parentNonce,
        runtimeNonce,
      },
      secret,
      openedAt,
    );
    duplicateCapabilityRuntime.emit('AUTHENTICATE', { parentNonce, runtimeNonce });
    await expect(
      bridge.acceptAuthenticatedBatch(
        capability,
        { workspaceId, principalId },
        {
          sessionId: rollbackSessionId,
          bytes: Buffer.concat([
            encodeBridgeLine(
              duplicateCapabilityRuntime.emit('CAPABILITIES', {
                capabilityCodes: ['health.read', 'quality.verify'],
              }),
            ),
            encodeBridgeLine(
              duplicateCapabilityRuntime.emit('CAPABILITIES', {
                capabilityCodes: ['health.read', 'quality.verify'],
              }),
            ),
          ]),
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    expect(secretLeaseRequests).toHaveLength(leaseCountBeforeMalformed);

    const beforeAudit = await prisma.auditEvent.count({
      where: { workspaceReference: workspaceId },
    });
    await expect(
      bridge.acceptAuthenticatedBatch(
        capability,
        { workspaceId, principalId },
        {
          sessionId: rollbackSessionId,
          bytes: Buffer.concat([
            encodeBridgeLine(
              runtime.emit('CAPABILITIES', {
                capabilityCodes: ['health.read', 'quality.verify'],
              }),
            ),
            encodeBridgeLine(runtime.emit('HEARTBEAT', { health: 'UNKNOWN' })),
          ]),
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    const rolledBack = await prisma.acpBridgeSession.findUniqueOrThrow({
      where: { workspaceId_id: { workspaceId, id: rollbackSessionId } },
    });
    expect(rolledBack.state).toBe('AUTHENTICATED');
    expect(rolledBack.expectedSequence).toBe(2);
    expect(
      await prisma.acpBridgeReceipt.count({
        where: { workspaceId, sessionId: rollbackSessionId, sequence: { gte: 2 } },
      }),
    ).toBe(0);
    expect(await prisma.auditEvent.count({ where: { workspaceReference: workspaceId } })).toBe(
      beforeAudit,
    );

    const policyRuntime = new DeterministicFakeRuntime(
      {
        workspaceId,
        runtimeId,
        connectionId,
        sessionId: rollbackSessionId,
        principalReference: `fixture-principal-${suffix}`,
        parentNonce,
        runtimeNonce,
      },
      secret,
      openedAt,
    );
    policyRuntime.emit('AUTHENTICATE', { parentNonce, runtimeNonce });
    await expect(
      bridge.acceptAuthenticatedBatch(
        capability,
        { workspaceId, principalId },
        {
          sessionId: rollbackSessionId,
          bytes: encodeBridgeLine(
            policyRuntime.emit('CAPABILITIES', { capabilityCodes: ['health.read'] }),
          ),
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);

    const crossWorkspaceRuntime = new DeterministicFakeRuntime(
      {
        workspaceId: otherWorkspaceId,
        runtimeId,
        connectionId,
        sessionId: rollbackSessionId,
        principalReference: `fixture-principal-${suffix}`,
        parentNonce,
        runtimeNonce,
      },
      secret,
      openedAt,
    );
    crossWorkspaceRuntime.emit('AUTHENTICATE', { parentNonce, runtimeNonce });
    await expect(
      bridge.acceptAuthenticatedBatch(
        capability,
        { workspaceId, principalId },
        {
          sessionId: rollbackSessionId,
          bytes: encodeBridgeLine(
            crossWorkspaceRuntime.emit('CAPABILITIES', {
              capabilityCodes: ['health.read', 'quality.verify'],
            }),
          ),
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);

    const skippedConsumerRuntime = new DeterministicFakeRuntime(
      {
        workspaceId,
        runtimeId,
        connectionId,
        sessionId: rollbackSessionId,
        principalReference: `fixture-principal-${suffix}`,
        parentNonce,
        runtimeNonce,
      },
      secret,
      openedAt,
    );
    skippedConsumerRuntime.emit('AUTHENTICATE', { parentNonce, runtimeNonce });
    const skippedConsumerBridge = testBridge({
      async withSecret() {
        return new Date() as never;
      },
    });
    await expect(
      skippedConsumerBridge.acceptAuthenticatedBatch(
        capability,
        { workspaceId, principalId },
        {
          sessionId: rollbackSessionId,
          bytes: encodeBridgeLine(
            skippedConsumerRuntime.emit('CAPABILITIES', {
              capabilityCodes: ['health.read', 'quality.verify'],
            }),
          ),
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);

    const invalidMacRuntime = new DeterministicFakeRuntime(
      {
        workspaceId,
        runtimeId,
        connectionId,
        sessionId: rollbackSessionId,
        principalReference: `fixture-principal-${suffix}`,
        parentNonce,
        runtimeNonce,
      },
      secret,
      openedAt,
    );
    invalidMacRuntime.emit('AUTHENTICATE', { parentNonce, runtimeNonce });
    const validCapability = invalidMacRuntime.emit('CAPABILITIES', {
      capabilityCodes: ['health.read', 'quality.verify'],
    });
    const invalidHeartbeat = {
      ...invalidMacRuntime.emit('HEARTBEAT', { health: 'HEALTHY' }),
      mac: 'A'.repeat(43),
    };
    await expect(
      bridge.acceptAuthenticatedBatch(
        capability,
        { workspaceId, principalId },
        {
          sessionId: rollbackSessionId,
          bytes: Buffer.concat([
            encodeBridgeLine(validCapability),
            encodeBridgeLine(invalidHeartbeat),
          ]),
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    expect(
      await prisma.acpBridgeReceipt.count({
        where: { workspaceId, sessionId: rollbackSessionId, sequence: { gte: 2 } },
      }),
    ).toBe(0);
  });

  it('serializes outbound capsules and rolls back stale, forged, lease, and audit failures', async () => {
    const planId = `outbox-${suffix}`;
    await prisma.acpRuntimeConnection.update({
      where: { workspaceId_id: { workspaceId, id: connectionId } },
      data: {
        status: 'PARTIAL',
        lastHeartbeatAt: new Date(),
        lastHeartbeatHealth: 'HEALTHY',
        lastHeartbeatSequence: 5,
        version: { increment: 1 },
      },
    });
    const plan = await taskRuns.createPlan(
      plannerCapability,
      { workspaceId, principalId },
      {
        workspaceId,
        idempotencyKey: `${planId}:plan`,
        policyVersion: 'dispatch-outbox-v1',
        objective: {
          id: `${planId}:objective`,
          title: 'Prepare bounded dispatch authorizations',
          desiredOutcome: 'No transport or delivery claim',
          maximumAuthority: 3,
          costLimit: { currency: 'EUR', maximumMinorUnits: 700, maximumComputeUnits: 700 },
          acceptanceCriteria: ['prepared-only'],
          verificationCriteria: ['direction-bound'],
          stopConditions: ['deny-on-drift'],
        },
        projects: [{ id: `${planId}:project`, title: 'Outbound authorization' }],
        tasks: ['one', 'two', 'three', 'four', 'five', 'six', 'seven'].map((label) => ({
          id: `${planId}:task:${label}`,
          projectId: `${planId}:project`,
          title: `Outbox fixture ${label}`,
          kind: 'quality.verify' as const,
          dependencyIds: [],
          requiredAuthority: 3 as const,
          costLimit: { currency: 'EUR', maximumMinorUnits: 100, maximumComputeUnits: 100 },
          estimatedDurationMs: 1_000,
          acceptanceCriteria: ['prepared-only'],
          verificationCriteria: ['direction-bound'],
          stopConditions: ['deny-on-drift'],
          retryPolicy: {
            maximumAttempts: 1,
            retryableFailureCodes: ['TRANSIENT'],
            stopAfterFailureCodes: ['DENIED'],
          },
          agentPolicy: { templateId: 'outbox-agent', scopes: ['quality.verify'] },
          routingPolicy: { capabilityId: 'quality.verify', maximumLatencyMs: 1_000 },
        })),
      },
    );
    refreshCandidateSnapshot({ maxConcurrentRuns: 10 });
    const prepared = [];
    for (const [index, task] of plan.objective.tasks.slice(0, 6).entries()) {
      const run = task.runs[0]!;
      const agentId = `${planId}:agent:${index}`;
      const reservation = await brokerReservations.reserveForPreparedRun(
        capability,
        { workspaceId, principalId },
        {
          reservationId: `${planId}:reservation:${index}`,
          runId: run.id,
          agentId,
          expectedRunVersion: run.version,
          idempotencyKey: `${planId}:reservation:${index}`,
        },
      );
      const dispatch = await bridge.prepareDispatch(
        capability,
        { workspaceId, principalId },
        {
          dispatchId: `${planId}:dispatch:${index}`,
          agentId,
          sessionId,
          idempotencyKey: `${planId}:dispatch:${index}`,
          brokerEvidence: {
            evidenceId: reservation.reservation.id,
            evidenceHash: reservation.reservation.evidenceHash,
            workspaceId,
            taskId: task.id,
            runId: run.id,
            agentId,
            runtimeId,
            connectionId,
          },
        },
      );
      prepared.push({
        task,
        run,
        dispatch: dispatch.dispatch,
        reservation: reservation.reservation,
      });
    }

    const auditBefore = await prisma.auditEvent.count({
      where: { workspaceReference: workspaceId },
    });
    const sequenceBaseline =
      (
        await prisma.acpBridgeDispatchOutbox.aggregate({
          where: { workspaceId, sessionId },
          _max: { outboundSequence: true },
        })
      )._max.outboundSequence ?? 0;
    const concurrent = await Promise.all(
      prepared.slice(0, 2).map(({ dispatch }, index) =>
        bridge.prepareDispatchAuthorization(
          capability,
          { workspaceId, principalId },
          {
            capsuleId: `${planId}:capsule:${index}`,
            dispatchId: dispatch.id,
            idempotencyKey: `${planId}:capsule:${index}`,
          },
        ),
      ),
    );
    expect(concurrent.map((result) => result.outbox.outboundSequence).sort()).toEqual([
      sequenceBaseline + 1,
      sequenceBaseline + 2,
    ]);
    expect(concurrent.every((result) => result.outbox.state === 'PREPARED')).toBe(true);
    expect(
      await prisma.acpBridgeDispatchOutbox.count({
        where: { workspaceId, id: { startsWith: `${planId}:capsule:` } },
      }),
    ).toBe(2);
    expect(
      (
        await bridge.prepareDispatchAuthorization(
          capability,
          { workspaceId, principalId },
          {
            capsuleId: `${planId}:capsule:0`,
            dispatchId: prepared[0]!.dispatch.id,
            idempotencyKey: `${planId}:capsule:0`,
          },
        )
      ).replayed,
    ).toBe(true);

    const beforeDenied = {
      audit: await prisma.auditEvent.count({ where: { workspaceReference: workspaceId } }),
      outbox: await prisma.acpBridgeDispatchOutbox.count({ where: { workspaceId } }),
    };
    await expect(
      testBridge(new DenyBridgeSecretLeaseResolver()).prepareDispatchAuthorization(
        capability,
        { workspaceId, principalId },
        {
          capsuleId: `${planId}:capsule:lease-denied`,
          dispatchId: prepared[2]!.dispatch.id,
          idempotencyKey: `${planId}:capsule:lease-denied`,
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    expect(await prisma.acpBridgeDispatchOutbox.count({ where: { workspaceId } })).toBe(
      beforeDenied.outbox,
    );
    expect(await prisma.auditEvent.count({ where: { workspaceReference: workspaceId } })).toBe(
      beforeDenied.audit,
    );

    await prisma.acpRuntimeConnection.update({
      where: { workspaceId_id: { workspaceId, id: connectionId } },
      data: { lastHeartbeatAt: new Date(Date.now() - 59_500), version: { increment: 1 } },
    });
    let releaseConnection!: () => void;
    let reportConnectionLock!: () => void;
    const releaseConnectionLock = new Promise<void>((resolve) => (releaseConnection = resolve));
    const connectionLocked = new Promise<void>((resolve) => (reportConnectionLock = resolve));
    const blocker = prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "acp_runtime_connections" WHERE "workspaceId" = ${workspaceId}::uuid AND "id" = ${connectionId} FOR UPDATE`,
      );
      reportConnectionLock();
      await releaseConnectionLock;
    });
    await connectionLocked;
    const crossedFreshness = bridge.prepareDispatchAuthorization(
      capability,
      { workspaceId, principalId },
      {
        capsuleId: `${planId}:capsule:stale`,
        dispatchId: prepared[2]!.dispatch.id,
        idempotencyKey: `${planId}:capsule:stale`,
      },
    );
    expect(
      await Promise.race([
        crossedFreshness.then(
          () => 'settled',
          () => 'settled',
        ),
        new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 100)),
      ]),
    ).toBe('pending');
    await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
    releaseConnection();
    await blocker;
    await expect(crossedFreshness).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    expect(await prisma.acpBridgeDispatchOutbox.count({ where: { workspaceId } })).toBe(
      beforeDenied.outbox,
    );
    expect(await prisma.auditEvent.count({ where: { workspaceReference: workspaceId } })).toBe(
      beforeDenied.audit,
    );

    await prisma.acpRuntimeConnection.update({
      where: { workspaceId_id: { workspaceId, id: connectionId } },
      data: { lastHeartbeatAt: new Date(), version: { increment: 1 } },
    });
    const directDispatch = prepared[3]!.dispatch;
    const directRun = prepared[3]!.run;
    const directData = (issuedAt: Date, outboundSequence: number) => ({
      id: `${planId}:direct-capsule`,
      workspaceId,
      runtimeId,
      connectionId,
      sessionId,
      dispatchId: directDispatch.id,
      taskId: directDispatch.taskId,
      runId: directDispatch.runId,
      agentId: directDispatch.agentId,
      authorityLevel: directDispatch.authorityLevel,
      outboundSequence,
      messageId: `${planId}:direct-capsule`,
      messageType: 'DISPATCH',
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      state: 'PREPARED',
      brokerEvidenceId: directDispatch.brokerEvidenceId,
      brokerEvidenceHash: directDispatch.brokerEvidenceHash,
      assignmentEvidenceId: directDispatch.assignmentEvidenceId,
      assignmentEvidenceHash: directDispatch.assignmentEvidenceHash,
      dispatchEnvelopeHash: directDispatch.dispatchEnvelopeHash,
      policyHash: directRun.policyHash,
      capabilityPolicyHash,
      capabilityDigest: sha256Canonical(['health.read', 'quality.verify']),
      payloadDigest: '1'.repeat(64),
      unsignedEnvelopeDigest: '2'.repeat(64),
      signedEnvelopeDigest: '3'.repeat(64),
      authenticationTagDigest: '4'.repeat(64),
      idempotencyKey: `${planId}:direct-capsule`,
      issuedAt,
      expiresAt: new Date(issuedAt.getTime() + 5_000),
      preparedAt: issuedAt,
    });
    const insertDirectWithDatabaseClock = async (
      tx: Prisma.TransactionClient,
      outboundSequence: number,
    ) => {
      const row = directData(new Date(0), outboundSequence);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "acp_bridge_dispatch_outbox" (
          "id", "workspaceId", "runtimeId", "connectionId", "sessionId",
          "dispatchId", "taskId", "runId", "agentId", "authorityLevel",
          "outboundSequence", "messageId", "messageType", "protocolVersion", "state",
          "brokerEvidenceId", "brokerEvidenceHash", "assignmentEvidenceId",
          "assignmentEvidenceHash", "dispatchEnvelopeHash", "policyHash",
          "capabilityPolicyHash", "capabilityDigest", "payloadDigest",
          "unsignedEnvelopeDigest", "signedEnvelopeDigest", "authenticationTagDigest",
          "idempotencyKey", "issuedAt", "expiresAt", "preparedAt"
        )
        SELECT
          ${row.id}, ${row.workspaceId}::uuid, ${row.runtimeId}, ${row.connectionId},
          ${row.sessionId}, ${row.dispatchId}, ${row.taskId}, ${row.runId}, ${row.agentId},
          ${row.authorityLevel}, ${row.outboundSequence}, ${row.messageId},
          ${row.messageType}, ${row.protocolVersion}, ${row.state}, ${row.brokerEvidenceId},
          ${row.brokerEvidenceHash}, ${row.assignmentEvidenceId},
          ${row.assignmentEvidenceHash}, ${row.dispatchEnvelopeHash}, ${row.policyHash},
          ${row.capabilityPolicyHash}, ${row.capabilityDigest}, ${row.payloadDigest},
          ${row.unsignedEnvelopeDigest}, ${row.signedEnvelopeDigest},
          ${row.authenticationTagDigest}, ${row.idempotencyKey},
          db_clock."now" - INTERVAL '1 millisecond',
          db_clock."now" + INTERVAL '5 seconds',
          db_clock."now" - INTERVAL '1 millisecond'
        FROM (SELECT clock_timestamp() AS "now") AS db_clock
      `);
    };
    const lockDirectAuthority = async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "acp_bridge_sessions" WHERE "workspaceId" = ${workspaceId}::uuid AND "id" = ${sessionId} FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "acp_runtime_connections" WHERE "workspaceId" = ${workspaceId}::uuid AND "id" = ${connectionId} FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "acp_bridge_dispatches" WHERE "workspaceId" = ${workspaceId}::uuid AND "id" = ${directDispatch.id} FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "acp_runs" WHERE "workspaceId" = ${workspaceId}::uuid AND "id" = ${directDispatch.runId} FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "acp_tasks" WHERE "workspaceId" = ${workspaceId}::uuid AND "id" = ${directDispatch.taskId} FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "acp_runtimes" WHERE "workspaceId" = ${workspaceId}::uuid AND "id" = ${runtimeId} FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "acp_broker_reservations" WHERE "workspaceId" = ${workspaceId}::uuid AND "id" = ${directDispatch.brokerEvidenceId} FOR UPDATE`,
      );
    };
    await expect(
      prisma.acpBridgeDispatchOutbox.create({ data: directData(new Date(), 99) }),
    ).rejects.toThrow(/outbound sequence mismatch/iu);
    expect(
      await prisma.acpBridgeDispatchOutbox.count({
        where: { workspaceId, dispatchId: directDispatch.id },
      }),
    ).toBe(0);

    await prisma.acpRuntimeConnection.update({
      where: { workspaceId_id: { workspaceId, id: connectionId } },
      data: { lastHeartbeatAt: new Date(Date.now() - 59_500), version: { increment: 1 } },
    });
    let releaseDirectConnection!: () => void;
    let reportDirectConnectionLock!: () => void;
    const releaseDirectConnectionLock = new Promise<void>((resolve) => {
      releaseDirectConnection = resolve;
    });
    const directConnectionLocked = new Promise<void>((resolve) => {
      reportDirectConnectionLock = resolve;
    });
    const directBlocker = prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "acp_runtime_connections" WHERE "workspaceId" = ${workspaceId}::uuid AND "id" = ${connectionId} FOR UPDATE`,
      );
      reportDirectConnectionLock();
      await releaseDirectConnectionLock;
    });
    await directConnectionLocked;
    const directCrossedFreshness = prisma.acpBridgeDispatchOutbox.create({
      data: directData(new Date(), sequenceBaseline + 3),
    });
    expect(
      await Promise.race([
        directCrossedFreshness.then(
          () => 'settled',
          () => 'settled',
        ),
        new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 100)),
      ]),
    ).toBe('pending');
    await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
    releaseDirectConnection();
    await directBlocker;
    await expect(directCrossedFreshness).rejects.toThrow(/fresh partial bridge evidence/iu);
    expect(
      await prisma.acpBridgeDispatchOutbox.count({
        where: { workspaceId, dispatchId: directDispatch.id },
      }),
    ).toBe(0);

    await prisma.acpRuntimeConnection.update({
      where: { workspaceId_id: { workspaceId, id: connectionId } },
      data: { lastHeartbeatAt: new Date(Date.now() - 61_000), version: { increment: 1 } },
    });
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`SET LOCAL TIME ZONE 'America/Adak'`);
        await lockDirectAuthority(tx);
        await insertDirectWithDatabaseClock(tx, sequenceBaseline + 3);
      }),
    ).rejects.toThrow(/fresh partial bridge evidence/iu);
    expect(
      await prisma.acpBridgeDispatchOutbox.count({
        where: { workspaceId, dispatchId: directDispatch.id },
      }),
    ).toBe(0);

    await prisma.acpRuntimeConnection.update({
      where: { workspaceId_id: { workspaceId, id: connectionId } },
      data: { lastHeartbeatAt: new Date(), version: { increment: 1 } },
    });

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`SET LOCAL TIME ZONE 'Pacific/Kiritimati'`);
        await lockDirectAuthority(tx);
        await insertDirectWithDatabaseClock(tx, sequenceBaseline + 3);
        throw new Error('rollback timezone proof');
      }),
    ).rejects.toThrow('rollback timezone proof');
    expect(
      await prisma.acpBridgeDispatchOutbox.count({
        where: { workspaceId, dispatchId: directDispatch.id },
      }),
    ).toBe(0);

    const forged = await prisma.acpBridgeDispatchOutbox.create({
      data: directData(new Date(), sequenceBaseline + 3),
    });
    expect(forged.signedEnvelopeDigest).toBe('3'.repeat(64));
    await expect(
      bridge.prepareDispatchAuthorization(
        capability,
        { workspaceId, principalId },
        {
          capsuleId: `${planId}:direct-capsule`,
          dispatchId: directDispatch.id,
          idempotencyKey: `${planId}:direct-capsule`,
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionConflictError);
    expect(
      await prisma.acpBridgeDispatchOutbox.count({
        where: { workspaceId, dispatchId: directDispatch.id },
      }),
    ).toBe(1);

    const rollbackBridge = testBridge(testSecretLease(), brokerReservations, {
      async recordOperationalEvent() {
        throw new Error('synthetic outbox audit failure');
      },
    } as unknown as AuditService);
    await expect(
      rollbackBridge.prepareDispatchAuthorization(
        capability,
        { workspaceId, principalId },
        {
          capsuleId: `${planId}:capsule:audit-rollback`,
          dispatchId: prepared[2]!.dispatch.id,
          idempotencyKey: `${planId}:capsule:audit-rollback`,
        },
      ),
    ).rejects.toThrow('synthetic outbox audit failure');
    expect(
      await prisma.acpBridgeDispatchOutbox.count({
        where: { workspaceId, dispatchId: prepared[2]!.dispatch.id },
      }),
    ).toBe(0);
    expect(await prisma.auditEvent.count({ where: { workspaceReference: workspaceId } })).toBe(
      auditBefore + 2,
    );
    const crossingDispatch = prepared[4]!.dispatch;
    const crossingEnvelope = fake.emit('DISPATCH_ACCEPTED', {
      dispatchId: crossingDispatch.id,
      taskId: crossingDispatch.taskId,
      runId: crossingDispatch.runId,
      evidenceId: crossingDispatch.assignmentEvidenceId,
      assignmentEvidenceHash: crossingDispatch.assignmentEvidenceHash,
    });
    const crossing = await Promise.allSettled([
      bridge.prepareDispatchAuthorization(
        capability,
        { workspaceId, principalId },
        {
          capsuleId: `${planId}:capsule:crossing`,
          dispatchId: crossingDispatch.id,
          idempotencyKey: `${planId}:capsule:crossing`,
        },
      ),
      bridge.acceptRuntimeMessage(capability, { workspaceId, principalId }, crossingEnvelope),
    ]);
    expect(crossing[1]!.status).toBe('fulfilled');
    expect(
      crossing.every(
        (result) =>
          result.status === 'fulfilled' || !/40P01|deadlock detected/iu.test(String(result.reason)),
      ),
    ).toBe(true);
    expect(
      await prisma.acpBridgeReceipt.count({
        where: { workspaceId, messageId: crossingEnvelope.messageId },
      }),
    ).toBe(1);
    expect(
      (
        await prisma.acpBridgeDispatch.findUniqueOrThrow({
          where: { workspaceId_id: { workspaceId, id: crossingDispatch.id } },
        })
      ).state,
    ).toBe('ACCEPTED');
    expect(
      await prisma.acpBridgeDispatchOutbox.count({
        where: { workspaceId, dispatchId: crossingDispatch.id },
      }),
    ).toBe(crossing[0]!.status === 'fulfilled' ? 1 : 0);

    const newTask = plan.objective.tasks[6]!;
    const newRun = newTask.runs[0]!;
    const newAgentId = `${planId}:agent:6`;
    const newReservation = await brokerReservations.reserveForPreparedRun(
      capability,
      { workspaceId, principalId },
      {
        reservationId: `${planId}:reservation:6`,
        runId: newRun.id,
        agentId: newAgentId,
        expectedRunVersion: newRun.version,
        idempotencyKey: `${planId}:reservation:6`,
      },
    );
    let releaseSession!: () => void;
    let reportSessionLock!: () => void;
    const releaseSessionLock = new Promise<void>((resolve) => {
      releaseSession = resolve;
    });
    const sessionLocked = new Promise<void>((resolve) => {
      reportSessionLock = resolve;
    });
    const sessionBlocker = prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "acp_bridge_sessions" WHERE "workspaceId" = ${workspaceId}::uuid AND "id" = ${sessionId} FOR UPDATE`,
      );
      reportSessionLock();
      await releaseSessionLock;
    });
    await sessionLocked;
    const crossPathPromise = Promise.allSettled([
      bridge.prepareDispatchAuthorization(
        capability,
        { workspaceId, principalId },
        {
          capsuleId: `${planId}:capsule:prepare-crossing`,
          dispatchId: prepared[5]!.dispatch.id,
          idempotencyKey: `${planId}:capsule:prepare-crossing`,
        },
      ),
      bridge.prepareDispatch(
        capability,
        { workspaceId, principalId },
        {
          dispatchId: `${planId}:dispatch:6`,
          agentId: newAgentId,
          sessionId,
          idempotencyKey: `${planId}:dispatch:6`,
          brokerEvidence: {
            evidenceId: newReservation.reservation.id,
            evidenceHash: newReservation.reservation.evidenceHash,
            workspaceId,
            taskId: newTask.id,
            runId: newRun.id,
            agentId: newAgentId,
            runtimeId,
            connectionId,
          },
        },
      ),
    ]);
    expect(
      await Promise.race([
        crossPathPromise.then(() => 'settled'),
        new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 100)),
      ]),
    ).toBe('pending');
    releaseSession();
    await sessionBlocker;
    const crossPath = await crossPathPromise;
    expect(crossPath.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(
      crossPath.some(
        (result) =>
          result.status === 'rejected' &&
          /40P01|P2034|deadlock detected/iu.test(String(result.reason)),
      ),
    ).toBe(false);
    if (crossPath[1]!.status !== 'fulfilled') throw crossPath[1]!.reason;
    const newDispatch = crossPath[1]!.value.dispatch;
    expect(newDispatch.state).toBe('PREPARED');
    expect(
      await prisma.acpBridgeDispatchOutbox.count({
        where: { workspaceId, dispatchId: prepared[5]!.dispatch.id },
      }),
    ).toBe(1);
    const crossingAssignment = await taskRuns.reserveAssignment(
      capability,
      { workspaceId, principalId },
      {
        evidenceId: crossingDispatch.assignmentEvidenceId,
        evidenceHash: crossingDispatch.assignmentEvidenceHash,
        taskId: crossingDispatch.taskId,
        runId: crossingDispatch.runId,
        agentId: crossingDispatch.agentId,
        runtimeId: crossingDispatch.runtimeId,
        connectionId: crossingDispatch.connectionId,
      },
      prepared[4]!.run.version,
      `${planId}:crossing-assignment`,
    );
    const crossingStarted = await taskRuns.startRun(
      capability,
      { workspaceId, principalId },
      crossingDispatch.runId,
      crossingAssignment.run.version,
      `${planId}:crossing-start`,
    );
    await prisma.acpBridgeDispatch.update({
      where: { workspaceId_id: { workspaceId, id: crossingDispatch.id } },
      data: { state: 'FAILED', terminalAt: new Date() },
    });
    await taskRuns.failRun(
      capability,
      { workspaceId, principalId },
      crossingDispatch.runId,
      crossingStarted.run.version,
      'DENIED',
      `${planId}:crossing-stop`,
    );
    await prisma.acpBridgeDispatch.update({
      where: { workspaceId_id: { workspaceId, id: newDispatch.id } },
      data: { state: 'FAILED', terminalAt: new Date() },
    });
    await prisma.acpRun.update({
      where: { workspaceId_id: { workspaceId, id: newRun.id } },
      data: { status: 'STOPPED', version: { increment: 1 }, completedAt: new Date() },
    });
    for (const { dispatch, run } of prepared) {
      if (dispatch.id === crossingDispatch.id) continue;
      await prisma.acpBridgeDispatch.update({
        where: { workspaceId_id: { workspaceId, id: dispatch.id } },
        data: { state: 'FAILED', terminalAt: new Date() },
      });
      await prisma.acpRun.update({
        where: { workspaceId_id: { workspaceId, id: run.id } },
        data: { status: 'STOPPED', version: { increment: 1 }, completedAt: new Date() },
      });
    }
    expect(
      await prisma.acpBrokerReservation.count({
        where: {
          workspaceId,
          id: { startsWith: `${planId}:reservation:` },
          state: 'RELEASED',
        },
      }),
    ).toBe(prepared.length + 1);
  });

  it('serializes capacity reservations so two ready runs cannot claim one slot', async () => {
    const planId = `capacity-${suffix}`;
    const plan = await taskRuns.createPlan(
      plannerCapability,
      { workspaceId, principalId },
      {
        workspaceId,
        idempotencyKey: `${planId}:plan`,
        policyVersion: 'capacity-v1',
        objective: {
          id: `${planId}:objective`,
          title: 'Bound runtime capacity',
          desiredOutcome: 'Only one reservation survives',
          maximumAuthority: 3,
          costLimit: { currency: 'EUR', maximumMinorUnits: 500, maximumComputeUnits: 500 },
          acceptanceCriteria: ['capacity'],
          verificationCriteria: ['serialized'],
          stopConditions: ['deny'],
        },
        projects: [{ id: `${planId}:project`, title: 'Capacity' }],
        tasks: ['one', 'two', 'rollback', 'replay', 'reroute'].map((label) => ({
          id: `${planId}:task:${label}`,
          projectId: `${planId}:project`,
          title: `Capacity ${label}`,
          kind: 'quality.verify' as const,
          dependencyIds: [],
          requiredAuthority: 3 as const,
          costLimit: { currency: 'EUR', maximumMinorUnits: 100, maximumComputeUnits: 100 },
          estimatedDurationMs: 1_000,
          acceptanceCriteria: ['capacity'],
          verificationCriteria: ['serialized'],
          stopConditions: ['deny'],
          retryPolicy: {
            maximumAttempts: 1,
            retryableFailureCodes: ['TRANSIENT'],
            stopAfterFailureCodes: ['DENIED'],
          },
          agentPolicy: { templateId: 'capacity-agent', scopes: ['quality.verify'] },
          routingPolicy: { capabilityId: 'quality.verify', maximumLatencyMs: 1_000 },
        })),
      },
    );
    const runs = plan.objective.tasks.map((task) => task.runs[0]!);
    const routingRuns = runs.slice(0, 2);
    const [capacityClock] = await prisma.$queryRaw<Array<{ now: Date }>>(
      Prisma.sql`SELECT clock_timestamp() AS "now"`,
    );
    const capacityObservedAt = capacityClock!.now;
    const activeReservationsBefore = await prisma.acpBrokerReservation.count({
      where: {
        workspaceId,
        connectionId,
        OR: [{ state: 'CLAIMED' }, { state: 'RESERVED', expiresAt: { gt: capacityObservedAt } }],
      },
    });
    refreshCandidateSnapshot({ maxConcurrentRuns: activeReservationsBefore + 1 });
    const settled = await Promise.allSettled(
      routingRuns.map((run, index) =>
        brokerReservations.reserveForPreparedRun(
          capability,
          { workspaceId, principalId },
          {
            reservationId: `${planId}:reservation:${index}`,
            runId: run.id,
            agentId: `${planId}:agent:${index}`,
            expectedRunVersion: run.version,
            idempotencyKey: `${planId}:reservation:${index}`,
          },
        ),
      ),
    );
    expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(
      await prisma.acpBrokerReservation.count({
        where: { workspaceId, id: { startsWith: `${planId}:reservation:` }, state: 'RESERVED' },
      }),
    ).toBe(1);
    const fulfilledIndex = settled.findIndex((result) => result.status === 'fulfilled');
    await expect(
      brokerReservations.reserveForPreparedRun(
        capability,
        { workspaceId, principalId },
        {
          reservationId: `${planId}:reservation:${fulfilledIndex}`,
          runId: routingRuns[fulfilledIndex]!.id,
          agentId: `${planId}:drifted-agent`,
          expectedRunVersion: routingRuns[fulfilledIndex]!.version,
          idempotencyKey: `${planId}:reservation:${fulfilledIndex}`,
        },
      ),
    ).rejects.toThrow(/replay drifted/);
    await expect(
      brokerReservations.reserveForPreparedRun(
        capability,
        { workspaceId, principalId },
        {
          reservationId: `${planId}:reservation:${fulfilledIndex}`,
          runId: routingRuns[fulfilledIndex]!.id,
          agentId: `${planId}:agent:${fulfilledIndex}`,
          expectedRunVersion: routingRuns[fulfilledIndex]!.version + 1,
          idempotencyKey: `${planId}:reservation:${fulfilledIndex}`,
        },
      ),
    ).rejects.toThrow(/replay drifted/);

    const rejectedIndex = settled.findIndex((result) => result.status === 'rejected');
    const rejectedRun = routingRuns[rejectedIndex]!;
    const rejectedTask = await prisma.acpTask.findUniqueOrThrow({
      where: { workspaceId_id: { workspaceId, id: rejectedRun.taskId } },
    });
    const expiringId = `${planId}:expiring`;
    const expiringAgentId = `${planId}:expiring-agent`;
    const expiringAgentEvidenceId = `${planId}:expiring-agent-evidence`;
    const expiringAgentEvidenceHash = sha256Canonical({
      schemaVersion: 1,
      workspaceId,
      runId: rejectedRun.id,
      agentId: expiringAgentId,
      testOnly: true,
    });
    const expiringBinding = {
      workspaceId,
      objectiveId: rejectedRun.objectiveId,
      taskId: rejectedRun.taskId,
      runId: rejectedRun.id,
      agentId: expiringAgentId,
      agentEvidenceId: expiringAgentEvidenceId,
      agentEvidenceHash: expiringAgentEvidenceHash,
      runtimeId,
      connectionId,
      requestHash: '1'.repeat(64),
      candidateEvidenceId: `${planId}:expiring-candidates`,
      candidateEvidenceHash: '2'.repeat(64),
      taskPolicyHash: rejectedTask.policyHash,
      taskPolicyVersion: rejectedTask.policyVersion,
      expectedRunVersion: rejectedRun.version,
      selectedScoreBps: 9_000,
      estimatedCostMinorUnits: 1,
      reservedComputeUnits: 1,
      maxConcurrentRuns: 10,
      testOnly: true,
    } as const;
    const expiringEvidenceHash = computeBrokerReservationEvidenceHash(expiringBinding);
    await prisma.acpBrokerReservation.create({
      data: {
        id: expiringId,
        ...expiringBinding,
        estimatedCostMinorUnits: 1n,
        reservedComputeUnits: 1n,
        evidenceHash: expiringEvidenceHash,
        idempotencyKey: expiringId,
        expiresAt: new Date(Date.now() + 1_200),
      },
    });
    await expect(
      prisma.acpBrokerReservation.update({
        where: { workspaceId_id: { workspaceId, id: expiringId } },
        data: { state: 'EXPIRED', releasedAt: new Date() },
      }),
    ).rejects.toThrow(/cannot expire early/iu);
    await expect(
      prisma.acpBrokerReservation.update({
        where: { workspaceId_id: { workspaceId, id: expiringId } },
        data: {
          state: 'CLAIMED',
          claimedDispatchId: `${planId}:forged-dispatch`,
          claimedAt: new Date(),
        },
      }),
    ).rejects.toThrow(/trusted exact dispatch required/iu);
    let releaseLock!: () => void;
    let locked!: () => void;
    const lockedPromise = new Promise<void>((resolve) => (locked = resolve));
    const releasePromise = new Promise<void>((resolve) => (releaseLock = resolve));
    const lockTransaction = prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "acp_broker_reservations" WHERE "workspaceId"=${workspaceId}::uuid AND "id"=${expiringId} FOR UPDATE`,
      );
      locked();
      await releasePromise;
    });
    await lockedPromise;
    const crossedExpiry = bridge.prepareDispatch(
      capability,
      { workspaceId, principalId },
      {
        dispatchId: `${planId}:expired-dispatch`,
        agentId: expiringAgentId,
        sessionId,
        idempotencyKey: `${planId}:expired-dispatch`,
        brokerEvidence: {
          evidenceId: expiringId,
          evidenceHash: expiringEvidenceHash,
          workspaceId,
          taskId: rejectedRun.taskId,
          runId: rejectedRun.id,
          agentId: expiringAgentId,
          runtimeId,
          connectionId,
        },
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 1_400));
    releaseLock();
    await lockTransaction;
    await expect(crossedExpiry).rejects.toThrow(/broker reservation expired/iu);
    expect(
      await prisma.acpBridgeDispatch.count({
        where: { workspaceId, id: `${planId}:expired-dispatch` },
      }),
    ).toBe(0);

    refreshCandidateSnapshot({ maxConcurrentRuns: 10 });
    const rollbackRun = runs[2]!;
    let snapshotRead = 0;
    const provenanceDriftService = new AcpBrokerReservationService(
      new AuditService(),
      {
        async read() {
          snapshotRead += 1;
          return snapshotRead === 1
            ? { ...candidateSnapshot, testOnly: false }
            : {
                ...candidateSnapshot,
                evidenceId: `${candidateSnapshot.evidenceId}:drifted`,
                testOnly: true,
              };
        },
      },
      trustedAgentReader,
      {
        async allowsDeterministicFixture() {
          return true;
        },
      },
    );
    await expect(
      provenanceDriftService.reserveForPreparedRun(
        capability,
        { workspaceId, principalId },
        {
          reservationId: `${planId}:provenance-drift`,
          runId: rollbackRun.id,
          agentId: `${planId}:provenance-agent`,
          expectedRunVersion: rollbackRun.version,
          idempotencyKey: `${planId}:provenance-drift`,
        },
      ),
    ).rejects.toThrow(/candidate evidence changed/iu);
    expect(
      await prisma.acpBrokerReservation.count({
        where: { workspaceId, id: `${planId}:provenance-drift` },
      }),
    ).toBe(0);

    const rollbackService = new AcpBrokerReservationService(
      {
        async recordOperationalEvent() {
          throw new Error('synthetic broker audit failure');
        },
      } as unknown as AuditService,
      {
        async read() {
          return candidateSnapshot;
        },
      },
      trustedAgentReader,
      {
        async allowsDeterministicFixture() {
          return true;
        },
      },
    );
    await expect(
      rollbackService.reserveForPreparedRun(
        capability,
        { workspaceId, principalId },
        {
          reservationId: `${planId}:rollback-reservation`,
          runId: rollbackRun.id,
          agentId: `${planId}:rollback-agent`,
          expectedRunVersion: rollbackRun.version,
          idempotencyKey: `${planId}:rollback-reservation`,
        },
      ),
    ).rejects.toThrow('synthetic broker audit failure');
    expect(
      await prisma.acpBrokerReservation.findUnique({
        where: {
          workspaceId_id: { workspaceId, id: `${planId}:rollback-reservation` },
        },
      }),
    ).toBeNull();

    const rerouteRun = runs[4]!;
    const rerouteTask = await prisma.acpTask.findUniqueOrThrow({
      where: { workspaceId_id: { workspaceId, id: rerouteRun.taskId } },
    });
    const staleAgentId = `${planId}:reroute-agent`;
    const staleAgentEvidenceId = `${planId}:reroute-agent-evidence`;
    const staleAgentEvidenceHash = sha256Canonical({
      schemaVersion: 1,
      workspaceId,
      runId: rerouteRun.id,
      agentId: staleAgentId,
      testOnly: true,
    });
    const staleBinding = {
      workspaceId,
      objectiveId: rerouteRun.objectiveId,
      taskId: rerouteRun.taskId,
      runId: rerouteRun.id,
      agentId: staleAgentId,
      agentEvidenceId: staleAgentEvidenceId,
      agentEvidenceHash: staleAgentEvidenceHash,
      runtimeId,
      connectionId,
      requestHash: '4'.repeat(64),
      candidateEvidenceId: `${planId}:stale-candidates`,
      candidateEvidenceHash: '5'.repeat(64),
      taskPolicyHash: rerouteTask.policyHash,
      taskPolicyVersion: rerouteTask.policyVersion,
      expectedRunVersion: rerouteRun.version,
      selectedScoreBps: 9_000,
      estimatedCostMinorUnits: 1,
      reservedComputeUnits: 1,
      maxConcurrentRuns: 10,
      testOnly: true,
    } as const;
    await prisma.acpBrokerReservation.create({
      data: {
        id: `${planId}:stale-reservation`,
        ...staleBinding,
        estimatedCostMinorUnits: 1n,
        reservedComputeUnits: 1n,
        evidenceHash: computeBrokerReservationEvidenceHash(staleBinding),
        idempotencyKey: `${planId}:stale-reservation`,
        expiresAt: new Date(Date.now() - 5_000),
      },
    });
    const alternateRuntimeId = `${planId}:alternate-runtime`;
    const alternateConnectionId = `${planId}:alternate-connection`;
    const alternateSessionId = `${planId}:alternate-session`;
    await prisma.acpRuntime.create({
      data: {
        id: alternateRuntimeId,
        workspaceId,
        adapterKind: 'PROTOCOL_NEUTRAL',
        status: 'NOT_CONFIGURED',
        principalReference: `${planId}:alternate-principal`,
        secretReference: `${planId}:alternate-secret-ref`,
        secretDigest: '6'.repeat(64),
        capabilityPolicyHash,
        provisioningIdempotencyKey: `${planId}:alternate-provision`,
        connections: {
          create: {
            id: alternateConnectionId,
            environment: 'STAGING',
            status: 'NOT_CONFIGURED',
          },
        },
      },
    });
    const originalCandidate = candidateSnapshot.candidates[0]!;
    const alternateCandidate: RuntimeRoutingCandidate = {
      ...originalCandidate,
      runtimeId: alternateRuntimeId,
      connectionId: alternateConnectionId,
      trustEvidence: {
        registration: {
          ...originalCandidate.trustEvidence.registration,
          runtimeId: alternateRuntimeId,
          connectionId: alternateConnectionId,
        },
        capabilityExchange: {
          ...originalCandidate.trustEvidence.capabilityExchange,
          runtimeId: alternateRuntimeId,
          connectionId: alternateConnectionId,
        },
        heartbeat: {
          ...originalCandidate.trustEvidence.heartbeat,
          runtimeId: alternateRuntimeId,
          connectionId: alternateConnectionId,
          observedAt: new Date().toISOString(),
        },
        taskRoundTrip: {
          ...originalCandidate.trustEvidence.taskRoundTrip,
          runtimeId: alternateRuntimeId,
          connectionId: alternateConnectionId,
        },
      },
    };
    candidateSnapshot = {
      evidenceId: `${planId}:alternate-candidates`,
      evidenceHash: sha256Canonical([alternateCandidate]),
      testOnly: false,
      candidates: [alternateCandidate],
    };
    const rerouted = await brokerReservations.reserveForPreparedRun(
      capability,
      { workspaceId, principalId },
      {
        reservationId: `${planId}:rerouted-reservation`,
        runId: rerouteRun.id,
        agentId: staleAgentId,
        expectedRunVersion: rerouteRun.version,
        idempotencyKey: `${planId}:rerouted-reservation`,
      },
    );
    expect(rerouted.reservation.connectionId).toBe(alternateConnectionId);
    expect(rerouted.reservation.testOnly).toBe(true);
    expect(
      (
        await prisma.acpBrokerReservation.findUniqueOrThrow({
          where: { workspaceId_id: { workspaceId, id: `${planId}:stale-reservation` } },
        })
      ).state,
    ).toBe('EXPIRED');
    await prisma.acpBridgeSession.create({
      data: {
        id: alternateSessionId,
        workspaceId,
        runtimeId: alternateRuntimeId,
        connectionId: alternateConnectionId,
        principalReference: `${planId}:alternate-principal`,
        protocolVersion: 'ventureos.bridge.v1',
        state: 'PARTIAL',
        parentNonce: 'parent_nonce_1234567890',
        runtimeNonce: 'runtime_nonce_123456789',
        keyDigest: '7'.repeat(64),
        authenticatedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await expect(
      prisma.acpBridgeDispatch.create({
        data: {
          id: `${planId}:non-test-dispatch`,
          workspaceId,
          objectiveId: rerouteRun.objectiveId,
          taskId: rerouteRun.taskId,
          runId: rerouteRun.id,
          runtimeId: alternateRuntimeId,
          connectionId: alternateConnectionId,
          sessionId: alternateSessionId,
          agentId: staleAgentId,
          authorityLevel: 3,
          brokerEvidenceId: rerouted.reservation.id,
          brokerEvidenceHash: rerouted.reservation.evidenceHash,
          assignmentEvidenceHash: '8'.repeat(64),
          assignmentEvidenceId: `${planId}:alternate-assignment`,
          dispatchEnvelopeHash: '9'.repeat(64),
          idempotencyKey: `${planId}:non-test-dispatch`,
        },
      }),
    ).rejects.toThrow(/test-only broker evidence escaped fixture isolation/iu);
    expect(
      await prisma.acpBridgeDispatch.count({
        where: { workspaceId, id: `${planId}:non-test-dispatch` },
      }),
    ).toBe(0);

    refreshCandidateSnapshot({ maxConcurrentRuns: 10 });

    const replayRun = runs[3]!;
    const replayInput = {
      reservationId: `${planId}:concurrent-replay`,
      runId: replayRun.id,
      agentId: `${planId}:concurrent-agent`,
      expectedRunVersion: replayRun.version,
      idempotencyKey: `${planId}:concurrent-replay`,
    };
    const replayRace = await Promise.allSettled([
      brokerReservations.reserveForPreparedRun(
        capability,
        { workspaceId, principalId },
        replayInput,
      ),
      brokerReservations.reserveForPreparedRun(
        capability,
        { workspaceId, principalId },
        replayInput,
      ),
    ]);
    expect(replayRace.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(
      replayRace.filter(
        (result) => result.status === 'fulfilled' && result.value.replayed === true,
      ),
    ).toHaveLength(1);
    expect(
      await prisma.acpBrokerReservation.count({
        where: { workspaceId, id: replayInput.reservationId },
      }),
    ).toBe(1);
    await expect(
      brokerReservations.reserveForPreparedRun(
        capability,
        { workspaceId, principalId },
        {
          ...replayInput,
          reservationId: `${planId}:same-run-conflict`,
          idempotencyKey: `${planId}:same-run-conflict`,
        },
      ),
    ).rejects.toThrow(/active broker reservation already binds this run/iu);
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
    const artifactReceipt = await prisma.acpBridgeReceipt.findFirstOrThrow({
      where: { workspaceId, sessionId, dispatchId, messageType: 'ARTIFACT' },
    });
    await expect(
      prisma.acpRunUsage.create({
        data: {
          id: `forged-artifact-usage-${suffix}`,
          workspaceId,
          dispatchId,
          runId,
          sessionId,
          receiptId: artifactReceipt.id,
          sequence: artifactReceipt.sequence,
          computeUnits: 0,
          costMinorUnits: 0,
          cumulativeComputeUnits: 10,
          cumulativeCostMinorUnits: 10,
          currency: 'EUR',
          evidenceHash: '0'.repeat(64),
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.acpRunUsage.create({
        data: {
          id: `forged-cross-run-usage-${suffix}`,
          workspaceId,
          dispatchId,
          runId: cancelRunId,
          sessionId,
          receiptId: artifactReceipt.id,
          sequence: artifactReceipt.sequence,
          computeUnits: 0,
          costMinorUnits: 0,
          cumulativeComputeUnits: 10,
          cumulativeCostMinorUnits: 10,
          currency: 'EUR',
          evidenceHash: '0'.repeat(64),
        },
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
          runtimeId,
          connectionId,
          adapterKind: 'DETERMINISTIC_FAKE',
          environment: 'TEST_ONLY',
          principalReference: `fixture-principal-${suffix}`,
          secretReference,
          capabilityPolicyHash,
          idempotencyKey: `drifted-provision-${suffix}`,
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionConflictError);
    await expect(
      bridge.provisionRuntime(
        capability,
        { workspaceId, principalId },
        {
          runtimeId,
          connectionId,
          adapterKind: 'PROTOCOL_NEUTRAL',
          environment: 'TEST_ONLY',
          principalReference: `fixture-principal-${suffix}`,
          secretReference,
          capabilityPolicyHash,
          idempotencyKey: `provision-${suffix}`,
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionConflictError);
    await expect(
      bridge.provisionRuntime(
        capability,
        { workspaceId, principalId },
        {
          runtimeId: `fixture-production-${suffix}`,
          connectionId: `fixture-production-connection-${suffix}`,
          adapterKind: 'DETERMINISTIC_FAKE',
          environment: 'STAGING',
          principalReference: `fixture-production-principal-${suffix}`,
          secretReference: `vault-item-production-${suffix}`,
          capabilityPolicyHash,
          idempotencyKey: `fixture-production-${suffix}`,
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    const deniedFixtureBridge = new AcpBridgeAdmissionService(
      new AuditService(),
      testSecretLease(async () => secret),
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
      {
        async verify() {
          return false;
        },
      },
      {
        async allowsDeterministicFixture() {
          return false;
        },
      },
      new AcpCostGovernanceService(new AuditService()),
    );
    await expect(
      deniedFixtureBridge.provisionRuntime(
        capability,
        { workspaceId, principalId },
        {
          runtimeId: `fixture-denied-${suffix}`,
          connectionId: `fixture-denied-connection-${suffix}`,
          adapterKind: 'DETERMINISTIC_FAKE',
          environment: 'TEST_ONLY',
          principalReference: `fixture-denied-principal-${suffix}`,
          secretReference: `vault-item-denied-${suffix}`,
          capabilityPolicyHash,
          idempotencyKey: `fixture-denied-${suffix}`,
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
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
    expect(await prisma.acpRuntime.count({ where: { workspaceId, id: `codex:${suffix}` } })).toBe(
      0,
    );
    refreshCandidateSnapshot();
    await expect(
      brokerReservations.reserveForPreparedRun(
        capability,
        { workspaceId, principalId },
        {
          reservationId: `level4-reservation-${suffix}`,
          runId: level4RunId,
          agentId: `fixture-agent-${suffix}`,
          expectedRunVersion: 1,
          idempotencyKey: `level4-reservation-${suffix}`,
        },
      ),
    ).rejects.toThrow(/Level 0-3/);
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
            agentId: `fixture-agent-${suffix}`,
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
    const attempt = bridge.acceptAuthenticatedBatch(
      capability,
      { workspaceId, principalId },
      {
        sessionId: expirySessionId,
        bytes: encodeBridgeLine(capabilityFrame),
      },
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

  it('resamples the database clock after the secret consumer returns and rolls expiry back', async () => {
    const expirySessionId = `lease-expiry-session-${suffix}`;
    const openedAt = new Date();
    const expiresAt = new Date(openedAt.getTime() + 2_500);
    const parentNonce = `lease_expiry_parent_${suffix.replaceAll('-', '')}`;
    const runtimeNonce = `lease_expiry_runtime_${suffix.replaceAll('-', '')}`;
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
    const expiryRuntime = new DeterministicFakeRuntime(
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
      expiryRuntime.emit('AUTHENTICATE', { parentNonce, runtimeNonce }),
    );
    let consumerCompleted = false;
    const delayedBridge = testBridge({
      async withSecret(request, consumer) {
        expect(request).toEqual(
          expect.objectContaining({
            workspaceId,
            runtimeId,
            connectionId,
            secretReference,
            authGeneration: 1,
            purpose: 'VERIFY_FRAME',
          }),
        );
        const result = await consumer(secret);
        consumerCompleted = true;
        await new Promise<void>((resolve) =>
          setTimeout(resolve, Math.max(1, expiresAt.getTime() - Date.now() + 100)),
        );
        return result;
      },
    });
    await expect(
      delayedBridge.acceptAuthenticatedBatch(
        capability,
        { workspaceId, principalId },
        {
          sessionId: expirySessionId,
          bytes: encodeBridgeLine(
            expiryRuntime.emit('CAPABILITIES', {
              capabilityCodes: ['health.read', 'quality.verify'],
            }),
          ),
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    expect(consumerCompleted).toBe(true);
    expect(
      await prisma.acpBridgeReceipt.findFirst({
        where: { workspaceId, sessionId: expirySessionId, sequence: 2 },
      }),
    ).toBeNull();
    const durableSession = await prisma.acpBridgeSession.findUniqueOrThrow({
      where: { workspaceId_id: { workspaceId, id: expirySessionId } },
    });
    expect(durableSession.state).toBe('AUTHENTICATED');
    expect(durableSession.expectedSequence).toBe(2);
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
      testSecretLease(async () => secret),
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
      {
        async verify() {
          return false;
        },
      },
      {
        async allowsDeterministicFixture(requestWorkspaceId) {
          return requestWorkspaceId === erase.id;
        },
      },
      new AcpCostGovernanceService(new AuditService()),
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
        secretReference: `vault-item-erase-${suffix}`,
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
      testSecretLease(async () => secret),
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
      {
        async verify() {
          return false;
        },
      },
      {
        async allowsDeterministicFixture(requestWorkspaceId) {
          return requestWorkspaceId === rollback.id;
        },
      },
      new AcpCostGovernanceService(failingAudit),
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
          secretReference: `vault-item-rollback-${suffix}`,
          capabilityPolicyHash,
          idempotencyKey: `rollback-${suffix}`,
        },
      ),
    ).rejects.toThrow('synthetic audit failure');
    expect(await prisma.acpRuntime.count({ where: { workspaceId: rollback.id } })).toBe(0);
    await prisma.workspace.delete({ where: { id: rollback.id } });
  });

  it('retains recognized spend through parent erasure and removes it only with its workspace', async () => {
    expect(await prisma.acpCostLedgerEntry.count({ where: { workspaceId } })).toBeGreaterThan(0);
    await prisma.workspace.delete({ where: { id: workspaceId } });
    expect(await prisma.acpCostLedgerEntry.count({ where: { workspaceId } })).toBe(0);
    expect(
      await prisma.auditEvent.count({
        where: { workspaceReference: workspaceId, workspaceId: null },
      }),
    ).toBeGreaterThan(0);
  });
});
