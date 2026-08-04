export const HEALTH_CHECK_TIMEOUT_MS = 3_000;

/** Bounds dependency probes so readiness cannot hold an HTTP request open indefinitely. */
export async function withHealthTimeout<T>(
  operation: Promise<T>,
  timeoutMs = HEALTH_CHECK_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Health check timed out')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
