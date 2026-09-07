import { describe, expect, it, vi } from 'vitest';

import { canonicalJson } from './codec';
import {
  BoundedRetainedNativeSupervisorTopologyObservationCarrierChannel,
  BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerFrameEndpoint,
  BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerSession,
  DenyRetainedNativeSupervisorTopologyObservationCarrierByteChannel,
  DenyRetainedNativeSupervisorTopologyObservationCarrierMessageHandler,
  DenyRetainedNativeSupervisorTopologyObservationCarrierWorkerByteSession,
  MAX_RETAINED_NATIVE_TOPOLOGY_CARRIER_CHANNEL_FRAME_BYTES,
  type RetainedNativeSupervisorTopologyObservationCarrierByteChannel,
  type RetainedNativeSupervisorTopologyObservationCarrierMessageHandler,
  type RetainedNativeSupervisorTopologyObservationCarrierWorkerByteSession,
} from './retained-native-supervisor-topology-observation-carrier-channel';

function code(value: string) {
  return expect.objectContaining({ code: value });
}

function frame(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalJson(value));
}

class Handler implements RetainedNativeSupervisorTopologyObservationCarrierMessageHandler {
  readonly handle = vi.fn(async (input: unknown) => ({
    request: input,
    runtimeConnection: 'NOT_CONFIGURED',
    schemaVersion: 1,
  }));
}

class LoopbackChannel implements RetainedNativeSupervisorTopologyObservationCarrierByteChannel {
  readonly close = vi.fn(async () => undefined);
  readonly exchange = vi.fn((request: Uint8Array, signal: AbortSignal) =>
    this.endpoint.handle(request, signal),
  );

  constructor(
    readonly endpoint: BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerFrameEndpoint,
  ) {}
}

class WorkerByteSession implements RetainedNativeSupervisorTopologyObservationCarrierWorkerByteSession {
  readonly readToEof = vi.fn(async (_maximumBytes: number, _signal: AbortSignal) =>
    frame({ direction: 'COORDINATOR_TO_WORKER' }),
  );
  readonly writeAndShutdown = vi.fn(
    async (_responseFrame: Readonly<Uint8Array>, _signal: AbortSignal) => undefined,
  );
  readonly close = vi.fn(async () => undefined);
}

describe('bounded topology observation carrier byte channel', () => {
  it('carries exactly one canonical request and response and closes exactly once', async () => {
    const handler = new Handler();
    const endpoint =
      new BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerFrameEndpoint(handler);
    const channel = new LoopbackChannel(endpoint);
    const carrier = new BoundedRetainedNativeSupervisorTopologyObservationCarrierChannel(channel);
    const request = { direction: 'COORDINATOR_TO_WORKER', schemaVersion: 1 };

    await expect(carrier.exchange(request, new AbortController().signal)).resolves.toEqual({
      request,
      runtimeConnection: 'NOT_CONFIGURED',
      schemaVersion: 1,
    });
    expect(new TextDecoder().decode(channel.exchange.mock.calls[0]![0])).toBe(
      canonicalJson(request),
    );
    expect(handler.handle).toHaveBeenCalledOnce();
    expect(channel.close).toHaveBeenCalledOnce();
    await carrier.close();
    expect(channel.close).toHaveBeenCalledOnce();
    await expect(carrier.exchange(request, new AbortController().signal)).rejects.toEqual(
      code('CONCURRENT_EXCHANGE'),
    );
    await expect(endpoint.handle(frame(request), new AbortController().signal)).rejects.toEqual(
      code('CONCURRENT_EXCHANGE'),
    );
  });

  it('denies non-canonical, malformed, and oversized peer frames', async () => {
    for (const response of [
      new TextEncoder().encode('{"b":1,"a":2}'),
      new Uint8Array([0xff, 0xfe]),
      new Uint8Array(MAX_RETAINED_NATIVE_TOPOLOGY_CARRIER_CHANNEL_FRAME_BYTES + 1),
    ]) {
      const channel = {
        exchange: vi.fn(async () => response),
        close: vi.fn(async () => undefined),
      };
      const carrier = new BoundedRetainedNativeSupervisorTopologyObservationCarrierChannel(channel);
      await expect(
        carrier.exchange({ schemaVersion: 1 }, new AbortController().signal),
      ).rejects.toEqual(code('INVALID_ATTESTATION'));
      expect(channel.close).toHaveBeenCalledOnce();
    }
  });

  it('denies unsafe outbound input before channel exchange but still closes', async () => {
    const channel = {
      exchange: vi.fn(async () => frame({ schemaVersion: 1 })),
      close: vi.fn(async () => undefined),
    };
    const carrier = new BoundedRetainedNativeSupervisorTopologyObservationCarrierChannel(channel);
    await expect(
      carrier.exchange(
        { payload: 'x'.repeat(MAX_RETAINED_NATIVE_TOPOLOGY_CARRIER_CHANNEL_FRAME_BYTES) },
        new AbortController().signal,
      ),
    ).rejects.toEqual(code('INVALID_AUTHORIZATION'));
    expect(channel.exchange).not.toHaveBeenCalled();
    expect(channel.close).toHaveBeenCalledOnce();
  });

  it('propagates cancellation to a non-cooperating exchange and closes', async () => {
    let attemptSignal: AbortSignal | undefined;
    const channel = {
      exchange: vi.fn(async (_request: Uint8Array, signal: AbortSignal) => {
        attemptSignal = signal;
        return await new Promise<never>(() => undefined);
      }),
      close: vi.fn(async () => undefined),
    };
    const carrier = new BoundedRetainedNativeSupervisorTopologyObservationCarrierChannel(channel);
    const cancellation = new AbortController();
    const pending = carrier.exchange({ schemaVersion: 1 }, cancellation.signal);
    cancellation.abort();
    await expect(pending).rejects.toEqual(code('EXCHANGE_DENIED'));
    expect(attemptSignal?.aborted).toBe(true);
    expect(channel.close).toHaveBeenCalledOnce();
  });

  it('bounds a non-cooperating exchange and closes', async () => {
    const channel = {
      exchange: vi.fn(async () => await new Promise<never>(() => undefined)),
      close: vi.fn(async () => undefined),
    };
    const carrier = new BoundedRetainedNativeSupervisorTopologyObservationCarrierChannel(
      channel,
      100,
    );
    await expect(
      carrier.exchange({ schemaVersion: 1 }, new AbortController().signal),
    ).rejects.toEqual(code('EXCHANGE_DENIED'));
    expect(channel.close).toHaveBeenCalledOnce();
  });

  it('normalizes a synchronous channel failure and still closes', async () => {
    const channel = {
      exchange: vi.fn(() => {
        throw new Error('untrusted transport detail');
      }),
      close: vi.fn(async () => undefined),
    };
    const carrier = new BoundedRetainedNativeSupervisorTopologyObservationCarrierChannel(channel);
    await expect(
      carrier.exchange({ schemaVersion: 1 }, new AbortController().signal),
    ).rejects.toEqual(code('EXCHANGE_DENIED'));
    expect(channel.close).toHaveBeenCalledOnce();
  });

  it('bounds a non-cooperating close and withholds the response', async () => {
    const channel = {
      exchange: vi.fn(async () => frame({ schemaVersion: 1 })),
      close: vi.fn(async () => await new Promise<never>(() => undefined)),
    };
    const carrier = new BoundedRetainedNativeSupervisorTopologyObservationCarrierChannel(
      channel,
      100,
    );
    await expect(
      carrier.exchange({ schemaVersion: 1 }, new AbortController().signal),
    ).rejects.toEqual(code('EXCHANGE_DENIED'));
    expect(channel.close).toHaveBeenCalledOnce();
  });

  it('worker framing denies malformed input before handler invocation', async () => {
    const handler = new Handler();
    const endpoint =
      new BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerFrameEndpoint(handler);
    await expect(
      endpoint.handle(new TextEncoder().encode('{"b":1,"a":2}'), new AbortController().signal),
    ).rejects.toEqual(code('INVALID_AUTHORIZATION'));
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('worker framing bounds output and propagates cancellation', async () => {
    const oversized = {
      handle: vi.fn(async () => ({
        payload: 'x'.repeat(MAX_RETAINED_NATIVE_TOPOLOGY_CARRIER_CHANNEL_FRAME_BYTES),
      })),
    };
    await expect(
      new BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerFrameEndpoint(
        oversized,
      ).handle(frame({ schemaVersion: 1 }), new AbortController().signal),
    ).rejects.toEqual(code('INVALID_ATTESTATION'));

    let handlerSignal: AbortSignal | undefined;
    const blocked = {
      handle: vi.fn(async (_input: unknown, signal: AbortSignal) => {
        handlerSignal = signal;
        return await new Promise<never>(() => undefined);
      }),
    };
    const endpoint =
      new BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerFrameEndpoint(blocked);
    const cancellation = new AbortController();
    const pending = endpoint.handle(frame({ schemaVersion: 1 }), cancellation.signal);
    cancellation.abort();
    await expect(pending).rejects.toEqual(code('EXCHANGE_DENIED'));
    expect(handlerSignal?.aborted).toBe(true);
  });

  it('denies unconfigured channels and handlers at construction', () => {
    expect(
      () =>
        new BoundedRetainedNativeSupervisorTopologyObservationCarrierChannel(
          new DenyRetainedNativeSupervisorTopologyObservationCarrierByteChannel(),
        ),
    ).toThrow('NOT_CONFIGURED');
    expect(
      () =>
        new BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerFrameEndpoint(
          new DenyRetainedNativeSupervisorTopologyObservationCarrierMessageHandler(),
        ),
    ).toThrow('NOT_CONFIGURED');
  });

  it('owns one accepted worker byte session through response and close', async () => {
    const handler = new Handler();
    const endpoint =
      new BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerFrameEndpoint(handler);
    const byteSession = new WorkerByteSession();
    const session = new BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerSession(
      endpoint,
      byteSession,
    );

    await expect(session.handleOne(new AbortController().signal)).resolves.toBeUndefined();

    expect(byteSession.readToEof).toHaveBeenCalledWith(
      MAX_RETAINED_NATIVE_TOPOLOGY_CARRIER_CHANNEL_FRAME_BYTES,
      expect.any(AbortSignal),
    );
    expect(handler.handle).toHaveBeenCalledOnce();
    expect(byteSession.writeAndShutdown).toHaveBeenCalledOnce();
    expect(
      JSON.parse(new TextDecoder().decode(byteSession.writeAndShutdown.mock.calls[0]![0])),
    ).toEqual({
      request: { direction: 'COORDINATOR_TO_WORKER' },
      runtimeConnection: 'NOT_CONFIGURED',
      schemaVersion: 1,
    });
    expect(byteSession.close).toHaveBeenCalledOnce();
    await session.close();
    expect(byteSession.close).toHaveBeenCalledOnce();
    await expect(session.handleOne(new AbortController().signal)).rejects.toEqual(
      code('EXCHANGE_DENIED'),
    );
  });

  it('rejects substituted endpoints and deny sessions before ownership transfer', () => {
    const byteSession = new WorkerByteSession();
    expect(
      () =>
        new BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerSession(
          {
            handle: vi.fn(),
          } as unknown as BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerFrameEndpoint,
          byteSession,
        ),
    ).toThrow('NOT_CONFIGURED');
    expect(byteSession.readToEof).not.toHaveBeenCalled();
    expect(byteSession.writeAndShutdown).not.toHaveBeenCalled();
    expect(byteSession.close).not.toHaveBeenCalled();

    const endpoint =
      new BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerFrameEndpoint(
        new Handler(),
      );
    expect(
      () =>
        new BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerSession(
          endpoint,
          new DenyRetainedNativeSupervisorTopologyObservationCarrierWorkerByteSession(),
        ),
    ).toThrow('NOT_CONFIGURED');

    let getterCalls = 0;
    const hostileSession = {
      writeAndShutdown: vi.fn(),
      close: vi.fn(),
    } as Record<string, unknown>;
    Object.defineProperty(hostileSession, 'readToEof', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return vi.fn();
      },
    });
    expect(
      () =>
        new BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerSession(
          endpoint,
          hostileSession as unknown as RetainedNativeSupervisorTopologyObservationCarrierWorkerByteSession,
          99,
        ),
    ).toThrow('NOT_CONFIGURED');
    expect(getterCalls).toBe(0);
  });

  it('closes malformed and failed worker sessions without writing', async () => {
    const malformed = new WorkerByteSession();
    malformed.readToEof.mockResolvedValue(new TextEncoder().encode('{"b":1,"a":2}'));
    const malformedSession =
      new BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerSession(
        new BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerFrameEndpoint(
          new Handler(),
        ),
        malformed,
      );
    await expect(malformedSession.handleOne(new AbortController().signal)).rejects.toEqual(
      code('INVALID_AUTHORIZATION'),
    );
    expect(malformed.writeAndShutdown).not.toHaveBeenCalled();
    expect(malformed.close).toHaveBeenCalledOnce();

    const failed = new WorkerByteSession();
    const failedHandler = {
      handle: vi.fn(async (): Promise<never> => {
        throw new Error('private handler detail');
      }),
    };
    const failedSession =
      new BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerSession(
        new BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerFrameEndpoint(
          failedHandler,
        ),
        failed,
      );
    await expect(failedSession.handleOne(new AbortController().signal)).rejects.toEqual(
      code('EXCHANGE_DENIED'),
    );
    expect(failed.writeAndShutdown).not.toHaveBeenCalled();
    expect(failed.close).toHaveBeenCalledOnce();
  });

  it('propagates cancellation to a hung read and still closes exactly once', async () => {
    let readSignal: AbortSignal | undefined;
    const byteSession = new WorkerByteSession();
    byteSession.readToEof.mockImplementation(async (_maximumBytes, signal) => {
      readSignal = signal;
      return await new Promise<never>(() => undefined);
    });
    const session = new BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerSession(
      new BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerFrameEndpoint(
        new Handler(),
      ),
      byteSession,
    );
    const controller = new AbortController();
    const pending = session.handleOne(controller.signal);
    await vi.waitFor(() => expect(byteSession.readToEof).toHaveBeenCalledOnce());
    await expect(session.handleOne(new AbortController().signal)).rejects.toEqual(
      code('CONCURRENT_EXCHANGE'),
    );
    controller.abort();
    await expect(pending).rejects.toEqual(code('EXCHANGE_DENIED'));
    expect(readSignal?.aborted).toBe(true);
    expect(byteSession.writeAndShutdown).not.toHaveBeenCalled();
    expect(byteSession.close).toHaveBeenCalledOnce();
  });

  it('bounds close and does not report a delivered response as successful', async () => {
    const byteSession = new WorkerByteSession();
    byteSession.close.mockImplementation(async () => await new Promise<never>(() => undefined));
    const session = new BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerSession(
      new BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerFrameEndpoint(
        new Handler(),
      ),
      byteSession,
      100,
    );

    await expect(session.handleOne(new AbortController().signal)).rejects.toEqual(
      code('EXCHANGE_DENIED'),
    );
    expect(byteSession.writeAndShutdown).toHaveBeenCalledOnce();
    expect(byteSession.close).toHaveBeenCalledOnce();
  });
});
