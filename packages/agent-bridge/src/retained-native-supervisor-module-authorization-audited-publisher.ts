import {
  AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshotIssuance,
  type RetainedNativeSupervisorModuleAuthorizationSnapshotIssuanceEvidence,
  type RetainedNativeSupervisorModuleAuthorizationSnapshotPublicationSink,
} from './retained-native-supervisor-module-authorization-controller';
import {
  AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshot,
  BoundedRetainedNativeSupervisorModuleAuthorizationSnapshotAuthenticator,
} from './retained-native-supervisor-module-authorization-trust-source';
import { RetainedNativeSupervisorLocalIpcError } from './retained-native-supervisor-local-ipc';

const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const PRIVATE_TEXT =
  /(?:chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|access[-_. ]?token|auth(?:orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt)/iu;
const MAX_AUTHORIZATION_LIFETIME_MS = 5 * 60 * 1_000;

const AUTHENTICATED_AUDITED_PUBLICATION = Symbol(
  'authenticated-retained-native-module-audited-publication',
);

function deny(): never {
  throw new RetainedNativeSupervisorLocalIpcError('NOT_CONFIGURED');
}

function reference(value: unknown): string {
  if (typeof value !== 'string' || !SAFE_REFERENCE.test(value) || PRIVATE_TEXT.test(value)) deny();
  return value;
}

export class AuthenticatedRetainedNativeSupervisorModuleAuthorizationAuditedPublication {
  readonly #token: symbol;
  readonly #issuanceProof: AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshotIssuance;
  readonly issuance: Readonly<RetainedNativeSupervisorModuleAuthorizationSnapshotIssuanceEvidence>;

  constructor(
    token: symbol,
    readonly snapshot: AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshot,
    issuanceProof: AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshotIssuance,
  ) {
    if (token !== AUTHENTICATED_AUDITED_PUBLICATION) deny();
    AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshotIssuance.assertAuthenticated(
      issuanceProof,
    );
    this.#token = token;
    this.#issuanceProof = issuanceProof;
    this.issuance = issuanceProof.evidence;
    Object.freeze(this);
  }

  static assertAuthenticated(
    value: unknown,
  ): asserts value is AuthenticatedRetainedNativeSupervisorModuleAuthorizationAuditedPublication {
    try {
      if (
        !(
          value instanceof
          AuthenticatedRetainedNativeSupervisorModuleAuthorizationAuditedPublication
        ) ||
        value.#token !== AUTHENTICATED_AUDITED_PUBLICATION
      )
        deny();
      AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshot.assertAuthenticated(
        value.snapshot,
      );
      AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshotIssuance.assertAuthenticated(
        value.#issuanceProof,
      );
    } catch {
      deny();
    }
  }
}

export interface RetainedNativeSupervisorModuleAuthorizationAuditedPublicationStore {
  append(
    publication: AuthenticatedRetainedNativeSupervisorModuleAuthorizationAuditedPublication,
  ): Promise<'APPENDED' | 'REPLAYED'>;
}

export class DenyRetainedNativeSupervisorModuleAuthorizationAuditedPublicationStore implements RetainedNativeSupervisorModuleAuthorizationAuditedPublicationStore {
  async append(
    _publication: AuthenticatedRetainedNativeSupervisorModuleAuthorizationAuditedPublication,
  ): Promise<never> {
    return deny();
  }
}

/** Authenticates both the signed snapshot and its controller-minted approval proof before storage. */
export class BoundedRetainedNativeSupervisorModuleAuthorizationAuditedPublisher implements RetainedNativeSupervisorModuleAuthorizationSnapshotPublicationSink {
  readonly #workspaceId: string;
  readonly #supervisorInstanceId: string;
  readonly #authenticator: BoundedRetainedNativeSupervisorModuleAuthorizationSnapshotAuthenticator;

  constructor(
    expectedWorkspaceId: string,
    expectedSupervisorInstanceId: string,
    roots: readonly unknown[],
    private readonly store: RetainedNativeSupervisorModuleAuthorizationAuditedPublicationStore = new DenyRetainedNativeSupervisorModuleAuthorizationAuditedPublicationStore(),
    clock: () => number = Date.now,
  ) {
    this.#workspaceId = reference(expectedWorkspaceId);
    this.#supervisorInstanceId = reference(expectedSupervisorInstanceId);
    this.#authenticator =
      new BoundedRetainedNativeSupervisorModuleAuthorizationSnapshotAuthenticator(
        this.#supervisorInstanceId,
        roots,
        clock,
      );
    Object.freeze(this);
  }

  async publish(
    input: unknown,
    issuance: AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshotIssuance,
  ): Promise<'APPENDED' | 'REPLAYED'> {
    AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshotIssuance.assertAuthenticated(
      issuance,
    );
    const authenticated = this.#authenticator.authenticate(input);
    const { snapshot, snapshotHash, authenticatedAt } = authenticated;
    const evidence = issuance.evidence;
    const authorizedFrom = Date.parse(evidence.authorizedFrom);
    const authorizedUntil = Date.parse(evidence.authorizedUntil);
    if (
      evidence.schemaVersion !== 1 ||
      evidence.workspaceId !== this.#workspaceId ||
      evidence.supervisorInstanceId !== this.#supervisorInstanceId ||
      evidence.supervisorInstanceId !== snapshot.supervisorInstanceId ||
      evidence.snapshotId !== snapshot.snapshotId ||
      evidence.snapshotVersion !== snapshot.snapshotVersion ||
      evidence.signerKeyId !== snapshot.signerKeyId ||
      evidence.snapshotHash !== snapshotHash ||
      evidence.authorityLevel !== 3 ||
      evidence.runtimeConnection !== 'NOT_CONFIGURED' ||
      !Number.isFinite(authorizedFrom) ||
      !Number.isFinite(authorizedUntil) ||
      authorizedFrom > authenticatedAt ||
      authorizedUntil <= authenticatedAt ||
      authorizedUntil <= authorizedFrom ||
      authorizedUntil - authorizedFrom > MAX_AUTHORIZATION_LIFETIME_MS
    )
      deny();
    const publication =
      new AuthenticatedRetainedNativeSupervisorModuleAuthorizationAuditedPublication(
        AUTHENTICATED_AUDITED_PUBLICATION,
        authenticated,
        issuance,
      );
    let result: 'APPENDED' | 'REPLAYED';
    try {
      result = await this.store.append(publication);
    } catch {
      return deny();
    }
    if (result !== 'APPENDED' && result !== 'REPLAYED') deny();
    return result;
  }
}
