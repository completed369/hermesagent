import { describe, expect, it, vi } from 'vitest';

import { canonicalJson } from './codec';
import {
  BoundedRetainedNativeSupervisorTopologyObservationCarrierChannel,
  BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerFrameEndpoint,
  DenyRetainedNativeSupervisorTopologyObservationCarrierByteChannel,
  DenyRetainedNativeSupervisorTopologyObservationCarrierMessageHandler,
  MAX_RETAINED_NATIVE_TOPOLOGY_CARRIER_CHANNEL_FRAME_BYTES,
  type RetainedNativeSupervisorTopologyObservationCarrierByteChannel,
  type RetainedNativeSupervisorTopologyObservationCarrierMessageHandler,
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
});
