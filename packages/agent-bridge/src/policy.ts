import { BridgeProtocolError } from './codec';
import type { BridgeDispatchState, BridgeSessionState } from './protocol';
import { BRIDGE_DISPATCH_TRANSITIONS, BRIDGE_SESSION_TRANSITIONS } from './protocol';

export interface BridgeUsageDelta {
  readonly computeUnits: number;
  readonly costMinorUnits: number;
  readonly currency: string;
}

export function assertBridgeTransition(
  current: BridgeSessionState,
  next: BridgeSessionState,
): void {
  if (!BRIDGE_SESSION_TRANSITIONS[current].includes(next)) {
    throw new BridgeProtocolError(`Illegal bridge session transition ${current} -> ${next}`);
  }
}

export function assertDispatchTransition(
  current: BridgeDispatchState,
  next: BridgeDispatchState,
): void {
  if (!BRIDGE_DISPATCH_TRANSITIONS[current].includes(next)) {
    throw new BridgeProtocolError(`Illegal bridge dispatch transition ${current} -> ${next}`);
  }
}

export function validateUsageDelta(delta: BridgeUsageDelta): void {
  if (!Number.isSafeInteger(delta.computeUnits) || delta.computeUnits < 0) {
    throw new BridgeProtocolError('Compute usage must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(delta.costMinorUnits) || delta.costMinorUnits < 0) {
    throw new BridgeProtocolError('Cost usage must be a non-negative safe integer');
  }
  if (!/^[A-Z]{3}$/u.test(delta.currency))
    throw new BridgeProtocolError('Currency must be ISO-like');
}

export interface RuntimeProcessLaunchRequest {
  readonly executableReference: string;
  readonly runtimeId: string;
  readonly workspaceId: string;
}

export interface RuntimeProcessLauncher {
  launch(request: RuntimeProcessLaunchRequest): Promise<never>;
}

export class DenyRuntimeProcessLauncher implements RuntimeProcessLauncher {
  async launch(_request: RuntimeProcessLaunchRequest): Promise<never> {
    throw new BridgeProtocolError('Runtime process launching is not enabled');
  }
}
