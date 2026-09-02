import type {
  CodexValidationProcessSessionRecoveryEvidenceSource,
  CodexValidationProcessSessionRecoveryExitEvidence,
} from './codex-validation-process-session-recovery-evidence';
import type { CodexValidationProcessSessionRecoveryWorkItem } from './codex-validation-process-session-owner';
import {
  AuthenticatedRetainedNativeSupervisorRecoveryEvidenceSource,
  DenyRetainedNativeSupervisorRecoveryTransport,
  RetainedNativeSupervisorRecoveryError,
  type RetainedNativeSupervisorRecoveryResponseVerifier,
  type RetainedNativeSupervisorRecoveryTransport,
} from './retained-native-supervisor-recovery';
import {
  DenyRetainedNativeSupervisorTrustSource,
  type RetainedNativeSupervisorTrustSource,
  type VerifiedRetainedNativeSupervisorTrustSnapshot,
} from './retained-native-supervisor-trust-source';

function deny(code: 'NOT_CONFIGURED' | 'EXCHANGE_DENIED' | 'INVALID_RESPONSE'): never {
  throw new RetainedNativeSupervisorRecoveryError(code);
}

function sameTrustSnapshot(
  before: Readonly<VerifiedRetainedNativeSupervisorTrustSnapshot>,
  after: Readonly<VerifiedRetainedNativeSupervisorTrustSnapshot>,
): boolean {
  return (
    before.schemaVersion === after.schemaVersion &&
    before.snapshotId === after.snapshotId &&
    before.snapshotVersion === after.snapshotVersion &&
    before.snapshotHash === after.snapshotHash &&
    before.signerKeyId === after.signerKeyId &&
    before.rootRecordId === after.rootRecordId &&
    before.rootRecordVersion === after.rootRecordVersion &&
    before.supervisorInstanceId === after.supervisorInstanceId &&
    before.supervisorKeyId === after.supervisorKeyId &&
    before.trustRecordId === after.trustRecordId &&
    before.trustRecordVersion === after.trustRecordVersion &&
    before.issuedAt === after.issuedAt &&
    before.validUntil === after.validUntil
  );
}

/**
 * Composes fresh authenticated supervisor trust around exactly one bounded
 * recovery exchange. Trust must remain the same through the exchange; the
 * response is accepted only by the verifier returned from the post-exchange
 * read. No transport, trust roots, keys, or durable adapters are installed by
 * this class.
 */
export class FreshTrustRetainedNativeSupervisorRecoveryEvidenceSource implements CodexValidationProcessSessionRecoveryEvidenceSource {
  constructor(
    private readonly transport: RetainedNativeSupervisorRecoveryTransport,
    private readonly trustSource: RetainedNativeSupervisorTrustSource,
    private readonly clock: () => Date = () => new Date(),
  ) {
    if (
      transport instanceof DenyRetainedNativeSupervisorRecoveryTransport ||
      trustSource instanceof DenyRetainedNativeSupervisorTrustSource
    )
      deny('NOT_CONFIGURED');
  }

  async observe(
    workItem: Readonly<CodexValidationProcessSessionRecoveryWorkItem>,
  ): Promise<Readonly<CodexValidationProcessSessionRecoveryExitEvidence>> {
    let postExchangeTrust: Readonly<VerifiedRetainedNativeSupervisorTrustSnapshot> | null = null;
    const transport: RetainedNativeSupervisorRecoveryTransport = {
      exchange: async (request, signal) => {
        let before: Readonly<VerifiedRetainedNativeSupervisorTrustSnapshot>;
        try {
          before = await this.trustSource.read();
        } catch {
          deny('NOT_CONFIGURED');
        }
        if (signal.aborted) deny('EXCHANGE_DENIED');
        const candidate = await this.transport.exchange(request, signal);
        if (signal.aborted) deny('EXCHANGE_DENIED');
        let after: Readonly<VerifiedRetainedNativeSupervisorTrustSnapshot>;
        try {
          after = await this.trustSource.read();
        } catch {
          deny('NOT_CONFIGURED');
        }
        if (signal.aborted || !sameTrustSnapshot(before, after)) deny('EXCHANGE_DENIED');
        postExchangeTrust = after;
        return candidate;
      },
    };
    const verifier: RetainedNativeSupervisorRecoveryResponseVerifier = {
      verify: (response, request, observedAt) => {
        const trust = postExchangeTrust;
        postExchangeTrust = null;
        if (trust === null) deny('INVALID_RESPONSE');
        return trust.responseVerifier.verify(response, request, observedAt);
      },
    };
    return new AuthenticatedRetainedNativeSupervisorRecoveryEvidenceSource(
      transport,
      verifier,
      this.clock,
    ).observe(workItem);
  }
}
