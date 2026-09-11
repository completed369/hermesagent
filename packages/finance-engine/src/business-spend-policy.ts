/** Monetary amounts are integer EUR cents. These limits do not establish funding. */
export const BUSINESS_SPEND_LIMITS = Object.freeze({
  initialFundingCents: 10_000n,
  monthlyCents: 15_000n,
  singleCommitmentCents: 2_500n,
});

export class BusinessSpendDeniedError extends Error {}

export interface SpendCapacity {
  state: string;
  fundingFresh: boolean;
  availableCents: bigint;
  monthlyUsedCents: bigint;
  relatedUsedCents: bigint;
}

export function assertBusinessSpend(capacity: SpendCapacity, cents: bigint): void {
  if (typeof cents !== 'bigint' || cents <= 0n)
    throw new BusinessSpendDeniedError('A positive integer-cent commitment is required');
  if (capacity.state !== 'RUNNING')
    throw new BusinessSpendDeniedError('Business execution is paused or stopped');
  if (!capacity.fundingFresh)
    throw new BusinessSpendDeniedError('Available funding is not currently verified');
  if (cents + capacity.relatedUsedCents > BUSINESS_SPEND_LIMITS.singleCommitmentCents)
    throw new BusinessSpendDeniedError('Related purchases exceed the EUR 25 commitment limit');
  if (cents + capacity.monthlyUsedCents > BUSINESS_SPEND_LIMITS.monthlyCents)
    throw new BusinessSpendDeniedError('Paid and committed costs exceed the EUR 150 monthly limit');
  if (cents > capacity.availableCents)
    throw new BusinessSpendDeniedError(
      'Insufficient verified funds after reserves and commitments',
    );
}
