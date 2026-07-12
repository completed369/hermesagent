import { randomUUID } from 'node:crypto';

export function generateCorrelationId(): string {
  return randomUUID();
}

export const CORRELATION_HEADER = 'x-correlation-id';
