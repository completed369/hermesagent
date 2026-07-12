import { createHash } from 'node:crypto';

/**
 * Deterministic SHA-256 content hash used for package/artefact integrity
 * (products, listings, approvals). Any change to canonical content MUST
 * change this hash, invalidating any approval bound to the previous hash.
 */
export function hashContent(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Stable JSON stringify (sorted keys) so object hashing is order-independent. */
export function canonicalJsonStringify(value: unknown): string {
  const sortKeys = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sortKeys);
    if (input !== null && typeof input === 'object') {
      return Object.keys(input as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = sortKeys((input as Record<string, unknown>)[key]);
          return acc;
        }, {});
    }
    return input;
  };
  return JSON.stringify(sortKeys(value));
}

export function hashObject(value: unknown): string {
  return hashContent(canonicalJsonStringify(value));
}
