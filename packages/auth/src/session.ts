import { randomBytes } from 'node:crypto';

export function generateSessionToken(): string {
  return randomBytes(32).toString('hex');
}

export function sessionExpiryDate(maxAgeSeconds: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + maxAgeSeconds * 1000);
}

export function isSessionExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}
