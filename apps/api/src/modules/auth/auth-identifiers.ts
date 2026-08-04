import { isIP } from 'node:net';
import { createAuthAbuseDigest } from '@ventureos/auth';

export type AuthIdentifierKind = 'account' | 'ip';

export function normalizeAccountIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase();
}

export function normalizeSourceIp(sourceIp: string): string {
  const address = sourceIp.trim();
  const version = isIP(address);
  if (version === 0) {
    throw new Error('Invalid source IP address');
  }
  if (version === 4) return address;

  const hostname = new URL(`http://[${address}]/`).hostname;
  const canonical = hostname.slice(1, -1).toLowerCase();
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical);
  if (!mapped) return canonical;

  const high = Number.parseInt(mapped[1]!, 16);
  const low = Number.parseInt(mapped[2]!, 16);
  return [high >>> 8, high & 0xff, low >>> 8, low & 0xff].join('.');
}

export function digestAuthIdentifier(
  kind: AuthIdentifierKind,
  normalizedIdentifier: string,
  secret: string,
): string {
  return createAuthAbuseDigest(secret, kind, normalizedIdentifier);
}
