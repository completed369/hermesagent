import { randomUUID } from 'node:crypto';
import { Prisma, prisma } from '@ventureos/database';
import { z } from 'zod';

export const MEMORY_TYPES = ['FACT', 'DECISION', 'EPISODE', 'PROCEDURE'] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export const MEMORY_SENSITIVITIES = [
  'PUBLIC',
  'INTERNAL',
  'CONFIDENTIAL',
  'RESTRICTED',
] as const;
export type MemorySensitivity = (typeof MEMORY_SENSITIVITIES)[number];

export type MemoryStatus = 'ACTIVE' | 'SUPERSEDED' | 'ARCHIVED';

export interface MemoryRecord {
  id: string;
  workspaceId: string;
  type: MemoryType;
  summary: string;
  content: unknown;
  sourceType: string;
  sourceRef: string | null;
  confidence: number;
  sensitivity: MemorySensitivity;
  createdByAgent: string | null;
  tags: string[];
  importance: number;
  expiresAt: Date | null;
  status: MemoryStatus;
  supersedesId: string | null;
  supersededAt: Date | null;
  metadata: unknown | null;
  createdAt: Date;
}

const memoryInputSchema = z.object({
  workspaceId: z.string().uuid(),
  type: z.enum(MEMORY_TYPES),
  summary: z.string().trim().min(1).max(2000),
  content: z.unknown(),
  sourceType: z.string().trim().min(1).max(120),
  sourceRef: z.string().trim().min(1).max(1000).optional(),
  confidence: z.number().min(0).max(1).default(1),
  sensitivity: z.enum(MEMORY_SENSITIVITIES).default('INTERNAL'),
  createdByAgent: z.string().trim().min(1).max(160).optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(32).default([]),
  importance: z.number().int().min(0).max(100).default(50),
  expiresAt: z.date().optional(),
  metadata: z.unknown().optional(),
  supersedesId: z.string().uuid().optional(),
});

export type RememberMemoryInput = z.input<typeof memoryInputSchema>;

type RawMemoryRow = Omit<MemoryRecord, 'tags'> & { tags: unknown };

function normaliseRow(row: RawMemoryRow): MemoryRecord {
  return {
    ...row,
    confidence: Number(row.confidence),
    importance: Number(row.importance),
    tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === 'string') : [],
  };
}

async function readMemoryById(
  client: Pick<typeof prisma, '$queryRaw'>,
  workspaceId: string,
  memoryId: string,
): Promise<MemoryRecord | null> {
  const rows = await client.$queryRaw<RawMemoryRow[]>(Prisma.sql`
    SELECT
      "id", "workspaceId", "type", "summary", "content", "sourceType", "sourceRef",
      "confidence", "sensitivity", "createdByAgent", "tags", "importance", "expiresAt",
      "status", "supersedesId", "supersededAt", "metadata", "createdAt"
    FROM "memory_entries"
    WHERE "workspaceId" = CAST(${workspaceId} AS uuid)
      AND "id" = CAST(${memoryId} AS uuid)
    LIMIT 1
  `);
  return rows[0] ? normaliseRow(rows[0]) : null;
}

async function insertMemory(
  client: Pick<typeof prisma, '$executeRaw' | '$queryRaw'>,
  input: z.output<typeof memoryInputSchema>,
): Promise<MemoryRecord> {
  const id = randomUUID();
  const tagsJson = JSON.stringify([...new Set(input.tags.map((tag) => tag.toLowerCase()))].sort());
  const contentJson = JSON.stringify(input.content ?? null);
  const metadataJson = input.metadata === undefined ? null : JSON.stringify(input.metadata);

  await client.$executeRaw(Prisma.sql`
    INSERT INTO "memory_entries" (
      "id", "workspaceId", "type", "summary", "content", "sourceType", "sourceRef",
      "confidence", "sensitivity", "createdByAgent", "tags", "importance", "expiresAt",
      "status", "supersedesId", "metadata"
    ) VALUES (
      CAST(${id} AS uuid),
      CAST(${input.workspaceId} AS uuid),
      ${input.type},
      ${input.summary},
      CAST(${contentJson} AS jsonb),
      ${input.sourceType},
      ${input.sourceRef ?? null},
      ${input.confidence},
      ${input.sensitivity},
      ${input.createdByAgent ?? null},
      CAST(${tagsJson} AS jsonb),
      ${input.importance},
      ${input.expiresAt ?? null},
      'ACTIVE',
      ${input.supersedesId ? Prisma.sql`CAST(${input.supersedesId} AS uuid)` : Prisma.sql`NULL`},
      ${metadataJson === null ? Prisma.sql`NULL` : Prisma.sql`CAST(${metadataJson} AS jsonb)`}
    )
  `);

  const created = await readMemoryById(client, input.workspaceId, id);
  if (!created) throw new Error('Memory was created but could not be read back');
  return created;
}

/**
 * Store durable workspace-scoped memory. Callers must provide provenance via
 * sourceType/sourceRef. The function exposes no arbitrary update path; durable
 * corrections are represented by supersession instead of silent mutation.
 */
export async function rememberMemory(input: RememberMemoryInput): Promise<MemoryRecord> {
  const parsed = memoryInputSchema.parse(input);
  return insertMemory(prisma, parsed);
}

const recallInputSchema = z.object({
  workspaceId: z.string().uuid(),
  type: z.enum(MEMORY_TYPES).optional(),
  query: z.string().trim().max(500).default(''),
  tags: z.array(z.string().trim().min(1).max(80)).max(16).default([]),
  includeRestricted: z.boolean().default(false),
  limit: z.number().int().min(1).max(50).default(12),
});

export type RecallMemoriesInput = z.input<typeof recallInputSchema>;

/**
 * Recall active, non-expired memory from exactly one workspace. RESTRICTED
 * memory is excluded unless the caller deliberately opts in. Tag filtering is
 * applied after the bounded database query so the SQL surface remains narrow.
 */
export async function recallMemories(input: RecallMemoriesInput): Promise<MemoryRecord[]> {
  const parsed = recallInputSchema.parse(input);
  const searchPattern = parsed.query ? `%${parsed.query}%` : '';
  const candidateLimit = Math.min(100, Math.max(parsed.limit, parsed.limit * 4));

  const rows = await prisma.$queryRaw<RawMemoryRow[]>(Prisma.sql`
    SELECT
      "id", "workspaceId", "type", "summary", "content", "sourceType", "sourceRef",
      "confidence", "sensitivity", "createdByAgent", "tags", "importance", "expiresAt",
      "status", "supersedesId", "supersededAt", "metadata", "createdAt"
    FROM "memory_entries"
    WHERE "workspaceId" = CAST(${parsed.workspaceId} AS uuid)
      AND "status" = 'ACTIVE'
      AND ("expiresAt" IS NULL OR "expiresAt" > CURRENT_TIMESTAMP)
      AND (${parsed.type ?? null}::text IS NULL OR "type" = ${parsed.type ?? null})
      AND (${parsed.query} = '' OR "summary" ILIKE ${searchPattern})
      AND (${parsed.includeRestricted} = true OR "sensitivity" <> 'RESTRICTED')
    ORDER BY "importance" DESC, "createdAt" DESC
    LIMIT ${candidateLimit}
  `);

  const requestedTags = new Set(parsed.tags.map((tag) => tag.toLowerCase()));
  const memories = rows.map(normaliseRow).filter((memory) => {
    if (requestedTags.size === 0) return true;
    return memory.tags.some((tag) => requestedTags.has(tag.toLowerCase()));
  });
  return memories.slice(0, parsed.limit);
}

export interface SupersedeMemoryInput {
  workspaceId: string;
  memoryId: string;
  replacement: Omit<RememberMemoryInput, 'workspaceId' | 'supersedesId'>;
}

/**
 * Replace a memory without rewriting history. The existing row is locked and
 * marked SUPERSEDED in the same transaction that creates its replacement.
 */
export async function supersedeMemory(input: SupersedeMemoryInput): Promise<MemoryRecord> {
  const workspaceId = z.string().uuid().parse(input.workspaceId);
  const memoryId = z.string().uuid().parse(input.memoryId);
  const replacement = memoryInputSchema.parse({
    ...input.replacement,
    workspaceId,
    supersedesId: memoryId,
  });

  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string; status: MemoryStatus }>>(Prisma.sql`
      SELECT "id", "status"
      FROM "memory_entries"
      WHERE "workspaceId" = CAST(${workspaceId} AS uuid)
        AND "id" = CAST(${memoryId} AS uuid)
      FOR UPDATE
    `);
    if (!locked[0] || locked[0].status !== 'ACTIVE') {
      throw new Error('Active memory not found in workspace');
    }

    const created = await insertMemory(tx, replacement);
    await tx.$executeRaw(Prisma.sql`
      UPDATE "memory_entries"
      SET "status" = 'SUPERSEDED', "supersededAt" = CURRENT_TIMESTAMP
      WHERE "workspaceId" = CAST(${workspaceId} AS uuid)
        AND "id" = CAST(${memoryId} AS uuid)
        AND "status" = 'ACTIVE'
    `);
    return created;
  });
}
