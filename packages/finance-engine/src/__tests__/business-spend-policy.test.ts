import { describe, expect, it } from 'vitest';
import { assertBusinessSpend, type SpendCapacity } from '../business-spend-policy.js';

const funded: SpendCapacity = {
  state: 'RUNNING',
  fundingFresh: true,
  availableCents: 10_000n,
  monthlyUsedCents: 0n,
  relatedUsedCents: 0n,
};

describe('founder business spending mandate', () => {
  it('allows exactly EUR 25 but rejects EUR 25.01', () => {
    expect(() => assertBusinessSpend(funded, 2_500n)).not.toThrow();
    expect(() => assertBusinessSpend(funded, 2_501n)).toThrow(/25/);
  });
  it('counts related purchases together and includes existing monthly commitments', () => {
    expect(() => assertBusinessSpend({ ...funded, relatedUsedCents: 2_000n }, 501n)).toThrow(/25/);
    expect(() => assertBusinessSpend({ ...funded, monthlyUsedCents: 14_500n }, 501n)).toThrow(
      /150/,
    );
    expect(() => assertBusinessSpend({ ...funded, monthlyUsedCents: 14_500n }, 500n)).not.toThrow();
  });
  it('fails closed on unavailable funds, protected reserves, pause and stop', () => {
    expect(() => assertBusinessSpend({ ...funded, fundingFresh: false }, 1n)).toThrow(/verified/);
    expect(() => assertBusinessSpend({ ...funded, availableCents: 0n }, 1n)).toThrow(/funds/);
    for (const state of ['PAUSED', 'STOPPED', 'UNKNOWN'])
      expect(() => assertBusinessSpend({ ...funded, state }, 1n)).toThrow(/paused/);
  });
  it('rejects non-positive and non-integer monetary input', () => {
    for (const amount of [0n, -1n, 1.2, NaN, Infinity])
      expect(() => assertBusinessSpend(funded, amount as bigint)).toThrow(/integer/);
  });
});
