import type { CodexValidationProcessSessionRecoveryWorkItem } from './codex-validation-process-session-owner';
import {
  DenyCodexValidationProcessSessionRecoveryEvidenceSource,
  observeCodexValidationProcessSessionRecoveryExit,
  validateCodexValidationProcessSessionRecoveryExitEvidence,
  type CodexValidationProcessSessionRecoveryEvidenceSource,
  type CodexValidationProcessSessionRecoveryExitEvidence,
} from './codex-validation-process-session-recovery-evidence';
import { validateCodexValidationProcessSessionRecoveryWorkItem } from './codex-validation-process-session-recovery';

const MAX_ACTIVE_RECOVERIES = 1_024;

export type CodexValidationProcessSessionRecoveryCoordinatorErrorCode =
  'COMPLETION_DENIED' | 'CONCURRENT_RECOVERY' | 'LIMIT_EXCEEDED';

export class CodexValidationProcessSessionRecoveryCoordinatorError extends Error {
  constructor(readonly code: CodexValidationProcessSessionRecoveryCoordinatorErrorCode) {
    super(`Codex validation process-session recovery coordination denied: ${code}`);
  }
}

export interface CodexValidationProcessSessionRecoveryCompletionRequest {
  readonly workItem: Readonly<CodexValidationProcessSessionRecoveryWorkItem>;
  readonly exitEvidence: Readonly<CodexValidationProcessSessionRecoveryExitEvidence>;
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

export interface CodexValidationProcessSessionRecoveryCompletionAuthority {
  /** Must atomically reproduce the lease and persist evidence before cleanup. */
  complete(
    request: Readonly<CodexValidationProcessSessionRecoveryCompletionRequest>,
  ): Promise<void>;
}

export class DenyCodexValidationProcessSessionRecoveryCompletionAuthority implements CodexValidationProcessSessionRecoveryCompletionAuthority {
  async complete(
    _request: Readonly<CodexValidationProcessSessionRecoveryCompletionRequest>,
  ): Promise<never> {
    throw new CodexValidationProcessSessionRecoveryCoordinatorError('COMPLETION_DENIED');
  }
}

export interface CodexValidationProcessSessionRecoveryCoordinatorResult {
  readonly exitEvidence: Readonly<CodexValidationProcessSessionRecoveryExitEvidence>;
  readonly completionState: 'RECORDED';
  readonly runtimeConnection: 'NOT_CONFIGURED';
  readonly connectionTransition: 'NOT_APPLIED';
}

/**
 * Coordinates already-authorized metadata, independent exit observation, and
 * durable completion. It cannot discover, inspect, signal, or terminate a process.
 */
export class BoundedCodexValidationProcessSessionRecoveryCoordinator {
  readonly #active = new Set<string>();

  constructor(
    private readonly evidenceSource: CodexValidationProcessSessionRecoveryEvidenceSource = new DenyCodexValidationProcessSessionRecoveryEvidenceSource(),
    private readonly completionAuthority: CodexValidationProcessSessionRecoveryCompletionAuthority = new DenyCodexValidationProcessSessionRecoveryCompletionAuthority(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(
    workItemInput: unknown,
  ): Promise<Readonly<CodexValidationProcessSessionRecoveryCoordinatorResult>> {
    const workItem = validateCodexValidationProcessSessionRecoveryWorkItem(
      workItemInput,
      this.clock(),
    );
    const id = `${workItem.binding.workspaceId}:${workItem.recoveryLeaseId}:${workItem.recoveryGeneration}`;
    if (this.#active.has(id))
      throw new CodexValidationProcessSessionRecoveryCoordinatorError('CONCURRENT_RECOVERY');
    if (this.#active.size >= MAX_ACTIVE_RECOVERIES)
      throw new CodexValidationProcessSessionRecoveryCoordinatorError('LIMIT_EXCEEDED');
    this.#active.add(id);
    try {
      const exitEvidence = await observeCodexValidationProcessSessionRecoveryExit(
        workItem,
        this.evidenceSource,
        this.clock,
      );
      const completionObservedAt = this.clock();
      const completionWorkItem = validateCodexValidationProcessSessionRecoveryWorkItem(
        workItem,
        completionObservedAt,
      );
      const completionEvidence = validateCodexValidationProcessSessionRecoveryExitEvidence(
        exitEvidence,
        completionWorkItem,
        completionObservedAt,
      );
      try {
        await this.completionAuthority.complete(
          Object.freeze({
            workItem: completionWorkItem,
            exitEvidence: completionEvidence,
            runtimeConnection: 'NOT_CONFIGURED' as const,
          }),
        );
      } catch {
        throw new CodexValidationProcessSessionRecoveryCoordinatorError('COMPLETION_DENIED');
      }
      return Object.freeze({
        exitEvidence: completionEvidence,
        completionState: 'RECORDED' as const,
        runtimeConnection: 'NOT_CONFIGURED' as const,
        connectionTransition: 'NOT_APPLIED' as const,
      });
    } finally {
      this.#active.delete(id);
    }
  }
}
