import { describe, expect, it } from 'vitest';
import {
  LicenseKeyInvalidError,
  LicenseKeyNotFoundError,
  PlanLimitExceededError,
  PlanNotFoundError,
  SubscriptionAlreadyExistsError,
  SubscriptionNotFoundError,
} from '../errors';

describe('billing error classes', () => {
  it('are all real Error subclasses carrying their message', () => {
    const planNotFound = new PlanNotFoundError('no plan');
    const errors = [
      planNotFound,
      new SubscriptionNotFoundError('no subscription'),
      new PlanLimitExceededError('limit exceeded'),
      new LicenseKeyNotFoundError('no key'),
      new LicenseKeyInvalidError('bad key'),
      new SubscriptionAlreadyExistsError('already exists'),
    ];
    for (const err of errors) {
      expect(err).toBeInstanceOf(Error);
    }
    expect(planNotFound.message).toBe('no plan');
  });

  it('are distinguishable from one another via instanceof', () => {
    const limitExceeded = new PlanLimitExceededError('x');
    const notFound = new SubscriptionNotFoundError('y');
    expect(limitExceeded).not.toBeInstanceOf(SubscriptionNotFoundError);
    expect(notFound).not.toBeInstanceOf(PlanLimitExceededError);
  });
});
