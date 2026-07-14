import { describe, expect, it } from 'vitest';
import {
  BudgetLimitExceededError,
  BudgetNotFoundError,
  ExperimentInvalidStateError,
  ExperimentNotFoundError,
} from '../errors';

describe('finance-engine error classes', () => {
  it('BudgetNotFoundError is a real Error subclass carrying its message', () => {
    const err = new BudgetNotFoundError('BudgetAllocation abc not found');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('BudgetAllocation abc not found');
  });

  it('BudgetLimitExceededError carries the fail-closed context needed to explain the block', () => {
    const err = new BudgetLimitExceededError('would exceed limit', 'alloc-1', 100, 95);
    expect(err).toBeInstanceOf(Error);
    expect(err.budgetAllocationId).toBe('alloc-1');
    expect(err.limitEur).toBe(100);
    expect(err.spentEur).toBe(95);
  });

  it('ExperimentNotFoundError and ExperimentInvalidStateError are distinguishable Error subclasses', () => {
    const notFound = new ExperimentNotFoundError('Experiment not found');
    const invalidState = new ExperimentInvalidStateError('Experiment is already RUNNING');
    expect(notFound).toBeInstanceOf(Error);
    expect(invalidState).toBeInstanceOf(Error);
    expect(notFound).not.toBeInstanceOf(ExperimentInvalidStateError);
    expect(invalidState).not.toBeInstanceOf(ExperimentNotFoundError);
  });
});
