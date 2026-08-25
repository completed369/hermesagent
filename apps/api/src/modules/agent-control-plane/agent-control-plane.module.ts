import { Module } from '@nestjs/common';
import {
  ASSIGNMENT_EVIDENCE_VERIFIER,
  DURABLE_ARTIFACT_EVIDENCE_VERIFIER,
} from '@ventureos/agent-control-plane';
import {
  BRIDGE_BROKER_EVIDENCE_VERIFIER,
  BRIDGE_ARTIFACT_CONTENT_VERIFIER,
  BRIDGE_CAPABILITY_POLICY_VERIFIER,
  BRIDGE_SECRET_RESOLVER,
  BRIDGE_TEST_ONLY_GATE,
  type BridgeArtifactContentVerifier,
  type BridgeBrokerEvidenceVerifier,
  type BridgeCapabilityPolicyVerifier,
  type BridgeSecretResolver,
  type BridgeTestOnlyGate,
} from '@ventureos/agent-bridge';
import { AuditModule } from '../audit/audit.module';
import { AcpBridgeAdmissionService } from './acp-bridge-admission.service';
import { AcpTaskRunService } from './acp-task-run.service';

const denySecrets: BridgeSecretResolver = {
  async resolve() {
    throw new Error('Bridge secret resolution is not configured');
  },
};
const denyBrokerEvidence: BridgeBrokerEvidenceVerifier = {
  async verify() {
    return false;
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
    { provide: BRIDGE_SECRET_RESOLVER, useValue: denySecrets },
    { provide: BRIDGE_BROKER_EVIDENCE_VERIFIER, useValue: denyBrokerEvidence },
    { provide: BRIDGE_CAPABILITY_POLICY_VERIFIER, useValue: denyCapabilityPolicy },
    { provide: BRIDGE_ARTIFACT_CONTENT_VERIFIER, useValue: denyArtifactContent },
    { provide: BRIDGE_TEST_ONLY_GATE, useValue: denyTestOnlyGate },
    { provide: ASSIGNMENT_EVIDENCE_VERIFIER, useExisting: AcpBridgeAdmissionService },
    { provide: DURABLE_ARTIFACT_EVIDENCE_VERIFIER, useExisting: AcpBridgeAdmissionService },
  ],
  exports: [AcpTaskRunService, AcpBridgeAdmissionService],
})
export class AgentControlPlaneModule {}
