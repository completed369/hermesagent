import { scrypt, scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;

function derivePasswordKeyAsync(password: string, salt: string): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

/**
 * Valid scrypt hash used to equalize password verification when no account
 * hash is available. It was generated with this module's canonical
 * `hashPassword` scheme and is not an account credential.
 */
export const DUMMY_PASSWORD_HASH =
  '7c0a53d38e3f83f2a68a72ca3be0d93f:6d60eeab6c10b4ad3d50a30406f6624bec5be327ec52f03113cf7937655540a32a901a67bdb3649e55bd2870fe7c76982674c414f1070ba2fdaffe899dacd6db';

/** Hashes a password with a random salt using scrypt (no external native deps required). */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `${salt}:${derived}`;
}

/** Hashes on libuv's worker pool for public request paths. */
export async function hashPasswordAsync(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = await derivePasswordKeyAsync(password, salt);
  return `${salt}:${derived.toString('hex')}`;
}

/** Constant-time password verification against a stored `salt:hash` string. */
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const derived = scryptSync(password, salt, KEY_LENGTH);
  const stored_ = Buffer.from(hash, 'hex');
  if (derived.length !== stored_.length) return false;
  return timingSafeEqual(derived, stored_);
}

/** Runs scrypt on libuv's worker pool so public login does not block the event loop. */
export async function verifyPasswordAsync(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const stored_ = Buffer.from(hash, 'hex');
  const derived = await derivePasswordKeyAsync(password, salt);
  if (derived.length !== stored_.length) return false;
  return timingSafeEqual(derived, stored_);
}
