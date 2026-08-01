import { createHmac } from 'node:crypto';

/**
 * Produces a domain-separated pseudonymous key for durable authentication
 * abuse state. Callers must normalize the source value before hashing.
 */
export function createAuthAbuseDigest(
  secret: string,
  domain: 'account' | 'ip',
  normalizedValue: string,
): string {
  return createHmac('sha256', secret)
    .update(`ventureos:auth-abuse:v1:${domain}\0${normalizedValue}`)
    .digest('hex');
}
