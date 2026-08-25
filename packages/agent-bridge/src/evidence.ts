export interface BridgeSecretResolver {
  /** Trusted server-side secret store. Returned bytes must never be logged or persisted. */
  resolve(secretReference: string): Promise<Uint8Array>;
}

export interface TrustedBridgeBrokerEvidence {
  readonly evidenceId: string;
  readonly evidenceHash: string;
  readonly workspaceId: string;
  readonly taskId: string;
  readonly runId: string;
  readonly runtimeId: string;
  readonly connectionId: string;
}

export interface BridgeBrokerEvidenceVerifier {
  /** Must re-read server-owned broker evidence; caller assertions are never sufficient. */
  verify(evidence: TrustedBridgeBrokerEvidence): Promise<boolean>;
}

export interface BridgeCapabilityPolicyVerifier {
  /** Must bind the ordered capability set to the provisioned runtime policy. */
  verify(
    workspaceId: string,
    runtimeId: string,
    capabilityPolicyHash: string,
    capabilityCodes: readonly string[],
  ): Promise<boolean>;
}

export const BRIDGE_SECRET_RESOLVER = Symbol('BRIDGE_SECRET_RESOLVER');
export const BRIDGE_BROKER_EVIDENCE_VERIFIER = Symbol('BRIDGE_BROKER_EVIDENCE_VERIFIER');
export const BRIDGE_CAPABILITY_POLICY_VERIFIER = Symbol('BRIDGE_CAPABILITY_POLICY_VERIFIER');
