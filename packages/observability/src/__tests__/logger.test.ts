import { describe, expect, it, vi, afterEach } from 'vitest';
import { StructuredLogger } from '../logger';

describe('StructuredLogger', () => {
  afterEach(() => vi.restoreAllMocks());

  it('emits redacted, structured JSON and respects minLevel', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = new StructuredLogger('api', 'info');
    logger.debug('should not appear', { password: 'secret' });
    logger.info('hello', { password: 'secret', correlationId: 'c1' });
    expect(spy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(spy.mock.calls[0]![0] as string);
    expect(parsed.message).toBe('hello');
    expect(parsed.password).toBe('[REDACTED]');
    expect(parsed.correlationId).toBe('c1');
    expect(parsed.service).toBe('api');
  });
});
