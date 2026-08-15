import { Prisma, prisma } from '@ventureos/database';

export const COMMERCIAL_OBSERVATION_EVIDENCE_MODES = ['REAL', 'MOCK'] as const;
export type CommercialObservationEvidenceMode =
  (typeof COMMERCIAL_OBSERVATION_EVIDENCE_MODES)[number];

export const COMMERCIAL_OBSERVATION_SOURCE_TYPES = [
  'MARKETPLACE_EXPORT',
  'CUSTOMER_SUPPORT',
  'FOUNDER_OBSERVED',
  'MANUAL_IMPORT',
  'SYNTHETIC',
] as const;
export type CommercialObservationSourceType = (typeof COMMERCIAL_OBSERVATION_SOURCE_TYPES)[number];

export interface CommercialObservationProvenanceInput {
  evidenceMode?: CommercialObservationEvidenceMode;
  sourceType?: CommercialObservationSourceType;
  sourceRef?: string;
  observedAt?: Date;
  recordedBy?: string;
}

export interface CommercialObservationProvenance {
  experimentResultId: string;
  evidenceMode: CommercialObservationEvidenceMode;
  sourceType: CommercialObservationSourceType;
  sourceRef: string | null;
  observedAt: Date;
  recordedBy: string | null;
}

interface CommercialObservationProvenanceRow extends CommercialObservationProvenance {}

export class CommercialObservationProvenanceError extends Error {}

function normalizeProvenance(
  experimentResultId: string,
  input: CommercialObservationProvenanceInput,
): CommercialObservationProvenance {
  const evidenceMode = input.evidenceMode ?? 'MOCK';
  const sourceType = input.sourceType ?? 'SYNTHETIC';
  const sourceRef = input.sourceRef?.trim() || null;
  if (input.observedAt && !Number.isFinite(input.observedAt.getTime())) {
    throw new CommercialObservationProvenanceError('observedAt must be a valid date');
  }
  if (evidenceMode === 'REAL') {
    if (sourceType === 'SYNTHETIC') {
      throw new CommercialObservationProvenanceError(
        'REAL commercial evidence cannot use the SYNTHETIC source type',
      );
    }
    if (!sourceRef) {
      throw new CommercialObservationProvenanceError(
        'REAL commercial evidence requires a source reference',
      );
    }
    if (!input.observedAt) {
      throw new CommercialObservationProvenanceError(
        'REAL commercial evidence requires an observedAt timestamp',
      );
    }
  }
  return {
    experimentResultId,
    evidenceMode,
    sourceType,
    sourceRef,
    observedAt: input.observedAt ?? new Date(),
    recordedBy: input.recordedBy ?? null,
  };
}

export async function persistCommercialObservationProvenance(
  tx: Prisma.TransactionClient,
  experimentResultId: string,
  input: CommercialObservationProvenanceInput,
): Promise<CommercialObservationProvenance> {
  const provenance = normalizeProvenance(experimentResultId, input);
  await tx.$executeRaw(
    Prisma.sql`INSERT INTO "commercial_observation_provenance"
      ("experimentResultId", "evidenceMode", "sourceType", "sourceRef", "observedAt", "recordedBy")
      VALUES (
        ${provenance.experimentResultId}::uuid,
        ${provenance.evidenceMode},
        ${provenance.sourceType},
        ${provenance.sourceRef},
        ${provenance.observedAt},
        ${provenance.recordedBy}::uuid
      )`,
  );
  return provenance;
}

export async function getCommercialObservationProvenanceMap(
  experimentResultIds: string[],
  db: Pick<Prisma.TransactionClient, '$queryRaw'> = prisma,
): Promise<Map<string, CommercialObservationProvenance>> {
  const uniqueIds = [...new Set(experimentResultIds)];
  if (uniqueIds.length === 0) return new Map();
  const idSql = uniqueIds.map((id) => Prisma.sql`${id}::uuid`);
  const rows =
    (await db.$queryRaw<CommercialObservationProvenanceRow[]>(
      Prisma.sql`SELECT
      "experimentResultId",
      "evidenceMode",
      "sourceType",
      "sourceRef",
      "observedAt",
      "recordedBy"
    FROM "commercial_observation_provenance"
    WHERE "experimentResultId" IN (${Prisma.join(idSql)})`,
    )) ?? [];
  return new Map(
    rows.map((row) => [
      row.experimentResultId,
      {
        ...row,
        evidenceMode: row.evidenceMode as CommercialObservationEvidenceMode,
        sourceType: row.sourceType as CommercialObservationSourceType,
      },
    ]),
  );
}
