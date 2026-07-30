import { createHash, randomBytes } from 'node:crypto';

export function generateSessionToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Derives the non-reversible value persisted for equality lookup. The raw
 * bearer token exists only in the caller and the httpOnly cookie.
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function sessionExpiryDate(maxAgeSeconds: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + maxAgeSeconds * 1000);
}

export function isSessionExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}
