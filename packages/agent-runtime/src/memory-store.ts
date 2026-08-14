import { randomUUID } from 'node:crypto';
import { Prisma, prisma } from '@ventureos/database';
import { z } from 'zod';
import {
  assertWorkspaceScope,
  memoryKindSchema,
  memoryRecordSchema,
  memorySensitivitySchema,
  memoryWriteSchema,
  uuidSchema,
  type MemoryQuery,
  type MemoryRecord,
  type MemoryStore,
  type MemoryWrite,
} from './memory.js';

type MemorySqlClient = Pick<Prisma.TransactionClient, '$executeRaw' | '$queryRaw'>;

type RawMemoryRow = {
  id: string;
  workspaceId: string;
  kind: string;
  subject: string;
  key: string;
  payload: unknown;
  sourceRef: string;
  confidence: number;
  sensitivity: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
  supersededById: string | null;
  revokedAt: Date | null;
};

const actorSchema = z.string().trim().min(1);
const memoryIdSchema = uuidSchema;
const querySchema = z.object({
  workspaceId: uuidSchema,
  kinds: z.array(memoryKindSchema).max(4).optional(),
  subject: z.string().trim().min(1).optional(),
  keys: z.array(z.string().trim().min(1)).max(100).optional(),
  sensitivity: z.array(memorySensitivitySchema).max(4).optional(),
  asOf: z.coerce.date().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

function normaliseRow(row: RawMemoryRow): MemoryRecord {
  return memoryRecordSchema.parse({
    ...row,
    confidence: Number(row.confidence),
  });
}

async function readById(
  client: MemorySqlClient,
  workspaceId: string,
  memoryId: string,
): Promise<MemoryRecord | null> {
  const rows = await client.$queryRaw<RawMemoryRow[]>(Prisma.sql`
    SELECT
      "id", "workspaceId", "kind", "subject", "key", "payload", "sourceRef",
      "confidence", "sensitivity", "createdBy", "createdAt", "updatedAt",
      "expiresAt", "supersededById", "revokedAt"
    FROM "memory_entries"
    WHERE "workspaceId" = CAST(${workspaceId} AS uuid)
      AND "id" = CAST(${memoryId} AS uuid)
    LIMIT 1
  `);
  return rows[0] ? normaliseRow(rows[0]) : null;
}

async function insertMemory(
  client: MemorySqlClient,
  input: MemoryWrite,
  supersession?: { supersededById: string; supersededByActor: string },
): Promise<MemoryRecord> {
  const parsed = memoryWriteSchema.parse(input);
  const id = randomUUID();
  const payloadJson = JSON.stringify(parsed.payload);

  await client.$executeRaw(Prisma.sql`
    INSERT INTO "memory_entries" (
      "id", "workspaceId", "kind", "subject", "key", "payload", "sourceRef",
      "confidence", "sensitivity", "createdBy", "expiresAt", "supersededById",
      "supersededByActor"
    ) VALUES (
      CAST(${id} AS uuid),
      CAST(${parsed.workspaceId} AS uuid),
      ${parsed.kind},
      ${parsed.subject},
      ${parsed.key},
      CAST(${payloadJson} AS jsonb),
      ${parsed.sourceRef},
      ${parsed.confidence},
      ${parsed.sensitivity},
      ${parsed.createdBy},
      ${parsed.expiresAt ?? null},
      ${supersession ? Prisma.sql`CAST(${supersession.supersededById} AS uuid)` : Prisma.sql`NULL`},
      ${supersession?.supersededByActor ?? null}
    )
  `);

  const created = await readById(client, parsed.workspaceId, id);
  if (!created) throw new Error('Memory was created but could not be read back');
  return created;
}

export type MemoryAtomicOrdering = {
  tieBreak?: {
    payloadKey: string;
    rankByValue: Record<string, number>;
  };
};

type MemoryComparableRecord = Pick<MemoryRecord, 'payload' | 'createdAt'>;

function memoryDecisionTime(record: MemoryComparableRecord): number {
  const payload = record.payload;
  const decidedAt =
    typeof payload === 'object' && payload !== null && 'decidedAt' in payload
      ? new Date(String(payload.decidedAt)).getTime()
      : Number.NaN;
  return Number.isFinite(decidedAt) ? decidedAt : record.createdAt.getTime();
}

function memoryTieBreakRank(
  record: Pick<MemoryRecord, 'payload'>,
  ordering?: MemoryAtomicOrdering,
): number {
  const tieBreak = ordering?.tieBreak;
  if (!tieBreak) return 0;
  const payload = record.payload;
  if (typeof payload !== 'object' || payload === null || !(tieBreak.payloadKey in payload)) {
    return 0;
  }
  const value = String(payload[tieBreak.payloadKey as keyof typeof payload]);
  return tieBreak.rankByValue[value] ?? 0;
}

function memoryCompare(
  replacement: MemoryComparableRecord,
  current: MemoryComparableRecord,
  ordering?: MemoryAtomicOrdering,
): number {
  const timeDelta = memoryDecisionTime(replacement) - memoryDecisionTime(current);
  if (timeDelta !== 0) return timeDelta;
  return memoryTieBreakRank(replacement, ordering) - memoryTieBreakRank(current, ordering);
}

/**
 * PostgreSQL-backed governed memory implementation. The database is only an
 * implementation detail behind the stable MemoryStore contract; callers never
 * receive a cross-workspace query primitive or an arbitrary update method.
 */
export class PrismaMemoryStore implements MemoryStore {
  async put(input: MemoryWrite): Promise<MemoryRecord> {
    const parsed = memoryWriteSchema.parse(input);
    assertWorkspaceScope(parsed.workspaceId);
    return insertMemory(prisma, parsed);
  }

  async putOrSupersedeActiveByKey(
    input: MemoryWrite,
    actorId: string,
    ordering?: MemoryAtomicOrdering,
  ): Promise<{ active: MemoryRecord; inserted: MemoryRecord; superseded: MemoryRecord[] }> {
    const parsed = memoryWriteSchema.parse(input);
    const workspaceId = assertWorkspaceScope(parsed.workspaceId);
    const actor = actorSchema.parse(actorId);
    const replacementComparable = {
      payload: parsed.payload,
      createdAt: new Date(),
    };
    const lockKey = `${workspaceId}:${parsed.kind}:${parsed.subject}:${parsed.key}`;

    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
      );

      const activeRows = await tx.$queryRaw<RawMemoryRow[]>(Prisma.sql`
        SELECT
          "id", "workspaceId", "kind", "subject", "key", "payload", "sourceRef",
          "confidence", "sensitivity", "createdBy", "createdAt", "updatedAt",
          "expiresAt", "supersededById", "revokedAt"
        FROM "memory_entries"
        WHERE "workspaceId" = CAST(${workspaceId} AS uuid)
          AND "kind" = ${parsed.kind}
          AND "subject" = ${parsed.subject}
          AND "key" = ${parsed.key}
          AND "revokedAt" IS NULL
          AND "supersededById" IS NULL
          AND ("expiresAt" IS NULL OR "expiresAt" > CURRENT_TIMESTAMP)
        FOR UPDATE
      `);
      const activeRowsByNewestDecision = activeRows
        .map(normaliseRow)
        .sort((a, b) => memoryCompare(b, a, ordering));
      const currentActive = activeRowsByNewestDecision[0];

      if (!currentActive || memoryCompare(replacementComparable, currentActive, ordering) >= 0) {
        const inserted = await insertMemory(tx, parsed);
        if (activeRowsByNewestDecision.length) {
          const activeIds = activeRowsByNewestDecision.map((record) => record.id);
          await tx.$executeRaw(Prisma.sql`
            UPDATE "memory_entries"
            SET "supersededById" = CAST(${inserted.id} AS uuid),
                "supersededByActor" = ${actor},
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE "workspaceId" = CAST(${workspaceId} AS uuid)
              AND "id" IN (${Prisma.join(activeIds.map((id) => Prisma.sql`CAST(${id} AS uuid)`))})
              AND "revokedAt" IS NULL
              AND "supersededById" IS NULL
          `);
        }
        return { active: inserted, inserted, superseded: activeRowsByNewestDecision };
      }

      const inserted = await insertMemory(tx, parsed, {
        supersededById: currentActive.id,
        supersededByActor: actor,
      });
      return { active: currentActive, inserted, superseded: [inserted] };
    });
  }

  async query(input: MemoryQuery): Promise<MemoryRecord[]> {
    const parsed = querySchema.parse(input);
    const workspaceId = assertWorkspaceScope(parsed.workspaceId);
    const asOf = parsed.asOf ?? new Date();
    const clauses: Prisma.Sql[] = [
      Prisma.sql`"workspaceId" = CAST(${workspaceId} AS uuid)`,
      Prisma.sql`"revokedAt" IS NULL`,
      Prisma.sql`"supersededById" IS NULL`,
      Prisma.sql`("expiresAt" IS NULL OR "expiresAt" > ${asOf})`,
    ];

    if (parsed.kinds?.length) {
      clauses.push(Prisma.sql`"kind" IN (${Prisma.join(parsed.kinds)})`);
    }
    if (parsed.subject) {
      clauses.push(Prisma.sql`"subject" = ${parsed.subject}`);
    }
    if (parsed.keys?.length) {
      clauses.push(Prisma.sql`"key" IN (${Prisma.join(parsed.keys)})`);
    }
    if (parsed.sensitivity?.length) {
      clauses.push(Prisma.sql`"sensitivity" IN (${Prisma.join(parsed.sensitivity)})`);
    } else {
      clauses.push(Prisma.sql`"sensitivity" IN ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL')`);
    }

    const rows = await prisma.$queryRaw<RawMemoryRow[]>(Prisma.sql`
      SELECT
        "id", "workspaceId", "kind", "subject", "key", "payload", "sourceRef",
        "confidence", "sensitivity", "createdBy", "createdAt", "updatedAt",
        "expiresAt", "supersededById", "revokedAt"
      FROM "memory_entries"
      WHERE ${Prisma.join(clauses, ' AND ')}
      ORDER BY "createdAt" DESC, "id" DESC
      LIMIT ${parsed.limit}
    `);
    return rows.map(normaliseRow);
  }

  async revoke(workspaceId: string, memoryId: string, revokedBy: string): Promise<MemoryRecord> {
    const scopedWorkspaceId = assertWorkspaceScope(workspaceId);
    const id = memoryIdSchema.parse(memoryId);
    const actor = actorSchema.parse(revokedBy);

    return prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string; revokedAt: Date | null }>>(Prisma.sql`
        SELECT "id", "revokedAt"
        FROM "memory_entries"
        WHERE "workspaceId" = CAST(${scopedWorkspaceId} AS uuid)
          AND "id" = CAST(${id} AS uuid)
        FOR UPDATE
      `);
      if (!locked[0]) throw new Error('Memory not found in workspace');
      if (locked[0].revokedAt) throw new Error('Memory is already revoked');

      await tx.$executeRaw(Prisma.sql`
        UPDATE "memory_entries"
        SET "revokedAt" = CURRENT_TIMESTAMP,
            "revokedBy" = ${actor},
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "workspaceId" = CAST(${scopedWorkspaceId} AS uuid)
          AND "id" = CAST(${id} AS uuid)
      `);

      const revoked = await readById(tx, scopedWorkspaceId, id);
      if (!revoked) throw new Error('Revoked memory could not be read back');
      return revoked;
    });
  }

  async supersede(
    workspaceId: string,
    memoryId: string,
    replacement: MemoryWrite,
    actorId: string,
  ): Promise<{ previous: MemoryRecord; replacement: MemoryRecord }> {
    const scopedWorkspaceId = assertWorkspaceScope(workspaceId);
    const id = memoryIdSchema.parse(memoryId);
    const actor = actorSchema.parse(actorId);
    const parsedReplacement = memoryWriteSchema.parse(replacement);
    if (parsedReplacement.workspaceId !== scopedWorkspaceId) {
      throw new Error('Replacement memory must remain in the same workspace');
    }

    return prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{ id: string; revokedAt: Date | null; supersededById: string | null }>
      >(Prisma.sql`
        SELECT "id", "revokedAt", "supersededById"
        FROM "memory_entries"
        WHERE "workspaceId" = CAST(${scopedWorkspaceId} AS uuid)
          AND "id" = CAST(${id} AS uuid)
        FOR UPDATE
      `);
      const current = locked[0];
      if (!current) throw new Error('Memory not found in workspace');
      if (current.revokedAt || current.supersededById) {
        throw new Error('Only active memory can be superseded');
      }

      const createdReplacement = await insertMemory(tx, parsedReplacement);
      await tx.$executeRaw(Prisma.sql`
        UPDATE "memory_entries"
        SET "supersededById" = CAST(${createdReplacement.id} AS uuid),
            "supersededByActor" = ${actor},
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "workspaceId" = CAST(${scopedWorkspaceId} AS uuid)
          AND "id" = CAST(${id} AS uuid)
          AND "revokedAt" IS NULL
          AND "supersededById" IS NULL
      `);

      const previous = await readById(tx, scopedWorkspaceId, id);
      if (!previous) throw new Error('Superseded memory could not be read back');
      return { previous, replacement: createdReplacement };
    });
  }
}
