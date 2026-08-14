import { z } from 'zod';

export const memoryKindSchema = z.enum(['FACT', 'DECISION', 'EPISODE', 'PROCEDURE']);
export type MemoryKind = z.infer<typeof memoryKindSchema>;

export const memorySensitivitySchema = z.enum(['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED']);
export type MemorySensitivity = z.infer<typeof memorySensitivitySchema>;

export const memoryRecordSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  kind: memoryKindSchema,
  subject: z.string().min(1),
  key: z.string().min(1),
  payload: z.record(z.unknown()),
  sourceRef: z.string().min(1),
  confidence: z.number().min(0).max(1),
  sensitivity: memorySensitivitySchema,
  createdBy: z.string().min(1),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  expiresAt: z.coerce.date().nullable().optional(),
  supersededById: z.string().min(1).nullable().optional(),
  revokedAt: z.coerce.date().nullable().optional(),
});
export type MemoryRecord = z.infer<typeof memoryRecordSchema>;

export const memoryWriteSchema = memoryRecordSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  supersededById: true,
  revokedAt: true,
});
export type MemoryWrite = z.infer<typeof memoryWriteSchema>;

export type MemoryQuery = {
  workspaceId: string;
  kinds?: MemoryKind[];
  subject?: string;
  keys?: string[];
  sensitivity?: MemorySensitivity[];
  asOf?: Date;
  limit?: number;
};

export interface MemoryStore {
  put(input: MemoryWrite): Promise<MemoryRecord>;
  query(input: MemoryQuery): Promise<MemoryRecord[]>;
  revoke(workspaceId: string, memoryId: string, revokedBy: string): Promise<MemoryRecord>;
  supersede(
    workspaceId: string,
    memoryId: string,
    replacement: MemoryWrite,
    actorId: string,
  ): Promise<{ previous: MemoryRecord; replacement: MemoryRecord }>;
}

/**
 * Fail closed at every memory implementation boundary. Memory access must
 * always carry an explicit workspace; callers may never infer a global scope.
 */
export function assertWorkspaceScope(workspaceId: string): string {
  const parsed = z.string().min(1).safeParse(workspaceId);
  if (!parsed.success) throw new Error('workspaceId is required for memory access');
  return parsed.data;
}

/**
 * Memory is advisory context only. Default retrieval excludes revoked,
 * expired, and superseded records so stale context cannot silently drive an
 * agent decision.
 */
export function isActiveMemory(record: MemoryRecord, asOf = new Date()): boolean {
  if (record.revokedAt) return false;
  if (record.supersededById) return false;
  if (record.expiresAt && record.expiresAt <= asOf) return false;
  return true;
}
