import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifySlackSignature(
  raw: Buffer,
  timestamp: unknown,
  signature: unknown,
  secret: string,
  now = Date.now(),
): boolean {
  if (
    !secret ||
    raw.length > 64_000 ||
    typeof timestamp !== 'string' ||
    !/^\d{10}$/.test(timestamp) ||
    typeof signature !== 'string' ||
    !/^v0=[a-f0-9]{64}$/.test(signature) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300
  )
    return false;
  const expected =
    'v0=' + createHmac('sha256', secret).update(`v0:${timestamp}:`).update(raw).digest('hex');
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
