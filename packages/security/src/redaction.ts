/**
 * Secret redaction for structured logging (master spec: "secrets may not
 * appear in logs"). This is a defense-in-depth layer, not a substitute for
 * never logging secret material in the first place.
 */
const SECRET_KEY_PATTERN = /(secret|password|token|api[_-]?key|authorization|credential|private[_-]?key)/i;
const REDACTED = '[REDACTED]';

export function redactSecrets<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value as T;
  }
  if (typeof value !== 'object') return value;
  if (seen.has(value as object)) return value;
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((v) => redactSecrets(v, seen)) as unknown as T;
  }

  const output: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      output[key] = REDACTED;
    } else if (typeof val === 'object' && val !== null) {
      output[key] = redactSecrets(val, seen);
    } else {
      output[key] = val;
    }
  }
  return output as T;
}
