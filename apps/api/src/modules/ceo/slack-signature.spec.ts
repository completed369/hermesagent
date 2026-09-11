import { createHmac } from 'node:crypto';
import { expect, it } from 'vitest';
import { verifySlackSignature } from './slack-signature';

it('authenticates the original bytes and rejects forged, stale and malformed requests', () => {
  const raw = Buffer.from('{"event":"synthetic"}');
  const timestamp = '1788960000';
  const secret = 'synthetic-signing-key';
  const signature =
    'v0=' + createHmac('sha256', secret).update(`v0:${timestamp}:`).update(raw).digest('hex');
  const now = Number(timestamp) * 1000;
  expect(verifySlackSignature(raw, timestamp, signature, secret, now)).toBe(true);
  expect(verifySlackSignature(Buffer.from('{}'), timestamp, signature, secret, now)).toBe(false);
  expect(verifySlackSignature(raw, timestamp, signature, secret, now + 301_000)).toBe(false);
  expect(verifySlackSignature(raw, timestamp, 'v0=short', secret, now)).toBe(false);
  expect(verifySlackSignature(raw, timestamp, signature, '', now)).toBe(false);
});
