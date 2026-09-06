import {
  BoundedRetainedNativeSupervisorModuleAuthorizationSnapshotAuthenticator,
  BoundedRetainedNativeSupervisorModuleAuthorizationTrustSource,
  canonicalJson,
  validateLinuxRetainedNativeSupervisorModuleLoadRequest,
  type LinuxRetainedNativeSupervisorModuleAuthorization,
  type LinuxRetainedNativeSupervisorModuleAuthorizationSource,
  type LinuxRetainedNativeSupervisorModuleLoadRequest,
} from '@ventureos/agent-bridge';
import { Prisma } from '@ventureos/database';

import { PostgresRetainedNativeModuleAuthorizationRootRegistry } from './retained-native-module-authorization-root-registry';
import {
  PostgresRetainedNativeModuleAuthorizationCheckpointStore,
  PostgresRetainedNativeModuleAuthorizationAuditedSnapshotReader,
  type RetainedNativeModuleAuthorizationTrustSqlClient,
} from './retained-native-module-authorization-trust-state';

const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const PRIVATE_TEXT =
  /(?:chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|access[-_. ]?token|auth(?:orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt)/iu;

export class RetainedNativeModuleAuthorizationTrustCompositionDeniedError extends Error {}

export interface RetainedNativeModuleAuthorizationTrustTransactionClient extends RetainedNativeModuleAuthorizationTrustSqlClient {
  $transaction<T>(
    operation: (transaction: RetainedNativeModuleAuthorizationTrustSqlClient) => Promise<T>,
    options: Readonly<{ isolationLevel: 'Serializable' }>,
  ): Promise<T>;
}

function deny(): never {
  throw new RetainedNativeModuleAuthorizationTrustCompositionDeniedError(
    'Retained-native module authorization trust composition denied',
  );
}

function reference(value: unknown): string {
  if (typeof value !== 'string' || !SAFE_REFERENCE.test(value) || PRIVATE_TEXT.test(value)) deny();
  return value;
}

/**
 * One-attempt composition of workspace-scoped durable public roots, the latest signed snapshot,
 * and its durable anti-rollback checkpoint. After checkpoint advancement it transaction-locks and
 * re-reads both publication and root state, so a concurrent rotation or revocation cannot expose
 * authority from the stale view. It loads no module and remains absent from the service graph.
 */
export class PostgresRetainedNativeModuleAuthorizationTrustComposition implements LinuxRetainedNativeSupervisorModuleAuthorizationSource {
  #attempted = false;
  readonly #workspaceId: string;
  readonly #supervisorInstanceId: string;
  readonly #roots: PostgresRetainedNativeModuleAuthorizationRootRegistry;
  readonly #reader: PostgresRetainedNativeModuleAuthorizationAuditedSnapshotReader;
  readonly #checkpoints: PostgresRetainedNativeModuleAuthorizationCheckpointStore;
  readonly #database: RetainedNativeModuleAuthorizationTrustTransactionClient;

  constructor(
    database: RetainedNativeModuleAuthorizationTrustTransactionClient,
    workspaceId: string,
    supervisorInstanceId: string,
    private readonly clock: () => number = Date.now,
  ) {
    if (
      !database ||
      typeof database.$queryRaw !== 'function' ||
      typeof database.$transaction !== 'function' ||
      typeof clock !== 'function'
    )
      deny();
    this.#workspaceId = reference(workspaceId);
    this.#supervisorInstanceId = reference(supervisorInstanceId);
    this.#database = database;
    this.#roots = new PostgresRetainedNativeModuleAuthorizationRootRegistry(database);
    this.#reader = new PostgresRetainedNativeModuleAuthorizationAuditedSnapshotReader(
      database,
      this.#workspaceId,
      this.#supervisorInstanceId,
    );
    this.#checkpoints = new PostgresRetainedNativeModuleAuthorizationCheckpointStore(database);
  }

  async read(
    input: Readonly<LinuxRetainedNativeSupervisorModuleLoadRequest>,
  ): Promise<Readonly<LinuxRetainedNativeSupervisorModuleAuthorization>> {
    if (this.#attempted) deny();
    this.#attempted = true;
    try {
      const request = validateLinuxRetainedNativeSupervisorModuleLoadRequest(input);
      const rootsBefore = await this.#roots.read(this.#workspaceId, this.#supervisorInstanceId);
      if (rootsBefore.length < 1 || rootsBefore.length > 8) deny();
      const rawSnapshot = await this.#reader.read();
      const authenticated =
        new BoundedRetainedNativeSupervisorModuleAuthorizationSnapshotAuthenticator(
          this.#supervisorInstanceId,
          rootsBefore,
          this.clock,
        ).authenticate(rawSnapshot);
      const fixedReader = Object.freeze({
        read: async () => structuredClone(rawSnapshot),
      });
      const source = new BoundedRetainedNativeSupervisorModuleAuthorizationTrustSource(
        this.#supervisorInstanceId,
        fixedReader,
        this.#checkpoints,
        rootsBefore,
        this.clock,
      );
      const authorization = await source.read(request);
      const current = await this.#database.$transaction(
        async (transaction) => {
          const publicationLock = await transaction.$queryRaw<readonly unknown[]>(Prisma.sql`
            SELECT pg_advisory_xact_lock(
              hashtextextended(${this.#supervisorInstanceId}, 90497)
            ) AS "locked"
          `);
          if (!Array.isArray(publicationLock) || publicationLock.length !== 1) deny();
          const rootLock = await transaction.$queryRaw<readonly unknown[]>(Prisma.sql`
            SELECT pg_advisory_xact_lock(
              hashtextextended(${this.#supervisorInstanceId}, 90503)
            ) AS "locked"
          `);
          if (!Array.isArray(rootLock) || rootLock.length !== 1) deny();
          const rootsAfter = await new PostgresRetainedNativeModuleAuthorizationRootRegistry(
            transaction,
          ).read(this.#workspaceId, this.#supervisorInstanceId);
          const snapshotAfter =
            await new PostgresRetainedNativeModuleAuthorizationAuditedSnapshotReader(
              transaction,
              this.#workspaceId,
              this.#supervisorInstanceId,
            ).read();
          return (
            canonicalJson(rootsAfter) === canonicalJson(rootsBefore) &&
            canonicalJson(snapshotAfter) === canonicalJson(authenticated.snapshot)
          );
        },
        { isolationLevel: 'Serializable' },
      );
      if (!current) deny();
      return authorization;
    } catch {
      return deny();
    }
  }
}
