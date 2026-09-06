import type { OperationalEventCapability, WorkspaceContext } from '@ventureos/agent-control-plane';
import {
  BoundedRetainedNativeSupervisorModuleAuthorizationAuditedPublisher,
  BoundedRetainedNativeSupervisorModuleAuthorizationSnapshotController,
  retainedNativeSupervisorModuleAuthorizationSnapshotIssueRequestHash,
  validateRetainedNativeSupervisorModuleAuthorizationSnapshotIssueRequest,
  type RetainedNativeSupervisorModuleAuthorizationSnapshotIssuanceReceipt,
  type RetainedNativeSupervisorModuleAuthorizationSnapshotSigner,
} from '@ventureos/agent-bridge';

import { BoundedLevel3RetainedNativeModuleAuthorizationIssuanceAuthority } from './retained-native-module-authorization-issuance-authority';
import { PostgresRetainedNativeModuleAuthorizationRootRegistry } from './retained-native-module-authorization-root-registry';
import {
  PostgresRetainedNativeModuleAuthorizationAuditedPublicationStore,
  type RetainedNativeModuleAuthorizationTrustSqlClient,
} from './retained-native-module-authorization-trust-state';

export class RetainedNativeModuleAuthorizationIssuanceCompositionDeniedError extends Error {}

function deny(): never {
  throw new RetainedNativeModuleAuthorizationIssuanceCompositionDeniedError(
    'Retained-native module authorization issuance composition denied',
  );
}

/**
 * One-attempt composition of durable public roots, Level-3 issuance authority, an injected signer,
 * independent signature authentication, and durable audited publication. It neither provisions a
 * root nor obtains key material and remains absent from the API module until a signer service is
 * separately reviewed and configured.
 */
export class PostgresRetainedNativeModuleAuthorizationIssuanceComposition {
  #attempted = false;
  readonly #roots: PostgresRetainedNativeModuleAuthorizationRootRegistry;
  readonly #store: PostgresRetainedNativeModuleAuthorizationAuditedPublicationStore;

  constructor(
    database: RetainedNativeModuleAuthorizationTrustSqlClient,
    private readonly signer: RetainedNativeSupervisorModuleAuthorizationSnapshotSigner,
    private readonly clock: () => number = Date.now,
  ) {
    if (!signer || typeof signer.sign !== 'function' || typeof clock !== 'function') deny();
    this.#roots = new PostgresRetainedNativeModuleAuthorizationRootRegistry(database);
    this.#store = new PostgresRetainedNativeModuleAuthorizationAuditedPublicationStore(database);
  }

  async issue(
    input: unknown,
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    signal: AbortSignal,
  ): Promise<Readonly<RetainedNativeSupervisorModuleAuthorizationSnapshotIssuanceReceipt>> {
    if (this.#attempted || !(signal instanceof AbortSignal) || signal.aborted) deny();
    this.#attempted = true;
    let request: ReturnType<
      typeof validateRetainedNativeSupervisorModuleAuthorizationSnapshotIssueRequest
    >;
    try {
      request = validateRetainedNativeSupervisorModuleAuthorizationSnapshotIssueRequest(input);
      if (
        !context ||
        request.workspaceId !== context.workspaceId ||
        typeof context.principalId !== 'string'
      )
        deny();
    } catch {
      return deny();
    }

    const authorityRequest = Object.freeze({
      schemaVersion: 1 as const,
      purpose: request.purpose,
      workspaceId: request.workspaceId,
      supervisorInstanceId: request.supervisorInstanceId,
      snapshotId: request.snapshotId,
      snapshotVersion: request.snapshotVersion,
      signerKeyId: request.signerKeyId,
      issuanceRequestHash:
        retainedNativeSupervisorModuleAuthorizationSnapshotIssueRequestHash(request),
      runtimeConnection: 'NOT_CONFIGURED' as const,
    });
    let authority: BoundedLevel3RetainedNativeModuleAuthorizationIssuanceAuthority;
    try {
      authority = new BoundedLevel3RetainedNativeModuleAuthorizationIssuanceAuthority(
        capability,
        context,
        authorityRequest,
        this.clock,
      );
    } catch {
      return deny();
    }
    let roots;
    try {
      roots = await this.#roots.read(request.workspaceId, request.supervisorInstanceId);
    } catch {
      return deny();
    }
    if (
      signal.aborted ||
      roots.length < 1 ||
      roots.length > 8 ||
      roots.filter((root) => root.signerKeyId === request.signerKeyId).length !== 1
    )
      deny();
    const publisher = new BoundedRetainedNativeSupervisorModuleAuthorizationAuditedPublisher(
      request.workspaceId,
      request.supervisorInstanceId,
      roots,
      this.#store,
      this.clock,
    );
    const controller = new BoundedRetainedNativeSupervisorModuleAuthorizationSnapshotController(
      request.workspaceId,
      request.supervisorInstanceId,
      authority,
      this.signer,
      publisher,
      this.clock,
    );
    try {
      return await controller.issue(request, signal);
    } catch {
      return deny();
    }
  }
}
