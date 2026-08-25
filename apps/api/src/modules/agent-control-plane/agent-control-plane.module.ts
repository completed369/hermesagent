import { Module } from '@nestjs/common';
import {
  ASSIGNMENT_EVIDENCE_VERIFIER,
  DURABLE_ARTIFACT_EVIDENCE_VERIFIER,
  TRUSTED_BROKER_AGENT_READER,
  TRUSTED_BROKER_CANDIDATE_READER,
  sha256Canonical,
  type TrustedBrokerCandidateReader,
  type TrustedBrokerAgentReader,
} from '@ventureos/agent-control-plane';
import {
  BRIDGE_BROKER_EVIDENCE_VERIFIER,
  BRIDGE_ARTIFACT_CONTENT_VERIFIER,
  BRIDGE_CAPABILITY_POLICY_VERIFIER,
  BRIDGE_SECRET_LEASE_RESOLVER,
  DenyBridgeSecretLeaseResolver,
  BRIDGE_TEST_ONLY_GATE,
  type BridgeArtifactContentVerifier,
  type BridgeCapabilityPolicyVerifier,
  type BridgeTestOnlyGate,
} from '@ventureos/agent-bridge';
import { AuditModule } from '../audit/audit.module';
import { AcpBridgeAdmissionService } from './acp-bridge-admission.service';
import { AcpBrokerReservationService } from './acp-broker-reservation.service';
import { AcpTaskRunService } from './acp-task-run.service';

const denySecrets = new DenyBridgeSecretLeaseResolver();
const denyCandidates: TrustedBrokerCandidateReader = {
  async read() {
    return {
      evidenceId: 'broker-candidates:not-configured',
      evidenceHash: sha256Canonical([]),
      testOnly: false,
      candidates: [],
    };
  },
};
const denyAgents: TrustedBrokerAgentReader = {
  async read() {
    throw new Error('Trusted broker agent evidence is not configured');
  },
};
const denyCapabilityPolicy: BridgeCapabilityPolicyVerifier = {
  async verify() {
    return false;
  },
};
const denyArtifactContent: BridgeArtifactContentVerifier = {
  async verify() {
    return false;
  },
};
const denyTestOnlyGate: BridgeTestOnlyGate = {
  async allowsDeterministicFixture() {
    return false;
  },
};

/**
 * Service-only composition root. Evidence ports intentionally fail closed
 * until authenticated broker/runtime adapters are wired in a later change.
 */
@Module({
  imports: [AuditModule],
  providers: [
    AcpTaskRunService,
    AcpBridgeAdmissionService,
    AcpBrokerReservationService,
    { provide: BRIDGE_SECRET_LEASE_RESOLVER, useValue: denySecrets },
    { provide: TRUSTED_BROKER_CANDIDATE_READER, useValue: denyCandidates },
    { provide: TRUSTED_BROKER_AGENT_READER, useValue: denyAgents },
    { provide: BRIDGE_BROKER_EVIDENCE_VERIFIER, useExisting: AcpBrokerReservationService },
    { provide: BRIDGE_CAPABILITY_POLICY_VERIFIER, useValue: denyCapabilityPolicy },
    { provide: BRIDGE_ARTIFACT_CONTENT_VERIFIER, useValue: denyArtifactContent },
    { provide: BRIDGE_TEST_ONLY_GATE, useValue: denyTestOnlyGate },
    { provide: ASSIGNMENT_EVIDENCE_VERIFIER, useExisting: AcpBridgeAdmissionService },
    { provide: DURABLE_ARTIFACT_EVIDENCE_VERIFIER, useExisting: AcpBridgeAdmissionService },
  ],
  exports: [AcpTaskRunService, AcpBridgeAdmissionService, AcpBrokerReservationService],
})
export class AgentControlPlaneModule {}
