import { describe, expect, it } from 'vitest';
import { redactSecrets } from '../redaction';

describe('redactSecrets', () => {
  it('redacts top-level secret-like keys', () => {
    const result = redactSecrets({ password: 'hunter2', name: 'ok' }) as Record<string, unknown>;
    expect(result.password).toBe('[REDACTED]');
    expect(result.name).toBe('ok');
  });

  it('redacts nested secret-like keys', () => {
    const result = redactSecrets({ user: { apiKey: 'abc', email: 'a@b.com' } }) as any;
    expect(result.user.apiKey).toBe('[REDACTED]');
    expect(result.user.email).toBe('a@b.com');
  });

  it('handles arrays of objects', () => {
    const result = redactSecrets([{ token: 'x' }, { token: 'y' }]) as any[];
    expect(result[0].token).toBe('[REDACTED]');
    expect(result[1].token).toBe('[REDACTED]');
  });
});
