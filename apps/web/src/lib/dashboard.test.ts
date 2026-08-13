import { describe, expect, it } from 'vitest';
import {
  COMMAND_CENTRE_STATUS_COPY,
  ventureProposalCount,
  pendingApprovalCount,
  currentBudgetUtilisation,
  connectedIntegrationCount,
} from '@/lib/dashboard';

describe('Command Centre calculations', () => {
  it('uses environment-neutral deployment status copy', () => {
    expect(COMMAND_CENTRE_STATUS_COPY).not.toMatch(/verified local development build/i);
    expect(COMMAND_CENTRE_STATUS_COPY).not.toMatch(/production deployment remain/i);
    expect(COMMAND_CENTRE_STATUS_COPY).toMatch(/core workflows are available/i);
    expect(COMMAND_CENTRE_STATUS_COPY).toMatch(/founder approval remains required/i);
  });

  describe('ventureProposalCount', () => {
    it('returns the workspace ventureCount when available', () => {
      expect(ventureProposalCount(7)).toBe(7);
      expect(ventureProposalCount(0)).toBe(0);
    });

    it('returns null when data is unavailable (never a fabricated 0)', () => {
      expect(ventureProposalCount(null)).toBeNull();
      expect(ventureProposalCount(undefined)).toBeNull();
    });
  });

  describe('pendingApprovalCount', () => {
    it('counts only PENDING approvals across mixed states', () => {
      const approvals = [
        { id: 'a', state: 'PENDING' },
        { id: 'b', state: 'APPROVED' },
        { id: 'c', state: 'PENDING' },
        { id: 'd', state: 'REJECTED' },
        { id: 'e', state: 'EXPIRED' },
        { id: 'f', state: 'APPROVED_WITH_CONDITIONS' },
      ];
      expect(pendingApprovalCount(approvals)).toBe(2);
    });

    it('returns null when the request failed (never a fabricated 0)', () => {
      expect(pendingApprovalCount(null)).toBeNull();
      expect(pendingApprovalCount(undefined)).toBeNull();
    });
  });

  describe('currentBudgetUtilisation', () => {
    const now = new Date('2026-07-15T12:00:00Z');

    it('returns null when the request failed', () => {
      expect(currentBudgetUtilisation(null, now)).toBeNull();
      expect(currentBudgetUtilisation(undefined, now)).toBeNull();
    });

    it('returns null when there are no matching current active budgets', () => {
      const budgets = [
        {
          status: 'CLOSED',
          periodStart: '2026-01-01',
          periodEnd: '2026-02-01',
          totalLimitEur: 100,
          allocations: [],
        },
      ];
      expect(currentBudgetUtilisation(budgets, now)).toBeNull();
    });

    it('excludes CLOSED budgets and out-of-period budgets', () => {
      const budgets = [
        {
          status: 'CLOSED',
          periodStart: '2026-01-01',
          periodEnd: '2026-12-31',
          totalLimitEur: 999,
          allocations: [{ spentEur: 999 }],
        },
        {
          status: 'ACTIVE',
          periodStart: '2027-01-01',
          periodEnd: '2027-12-31',
          totalLimitEur: 500,
          allocations: [{ spentEur: 50 }],
        },
        {
          status: 'ACTIVE',
          periodStart: '2025-01-01',
          periodEnd: '2025-12-31',
          totalLimitEur: 500,
          allocations: [{ spentEur: 50 }],
        },
        {
          status: 'ACTIVE',
          periodStart: '2026-01-01',
          periodEnd: '2026-12-31',
          totalLimitEur: 200,
          allocations: [{ spentEur: 30 }],
        },
      ];
      const result = currentBudgetUtilisation(budgets, now);
      expect(result).not.toBeNull();
      expect(result).toEqual({ totalSpentEur: 30, totalLimitEur: 200 });
    });

    it('sums spent + limit across multiple current active budgets', () => {
      const budgets = [
        {
          status: 'ACTIVE',
          periodStart: '2026-01-01',
          periodEnd: '2026-12-31',
          totalLimitEur: 100,
          allocations: [{ spentEur: 10 }],
        },
        {
          status: 'ACTIVE',
          periodStart: '2026-01-01',
          periodEnd: '2026-12-31',
          totalLimitEur: 50,
          allocations: [{ spentEur: 5 }, { spentEur: 3 }],
        },
      ];
      expect(currentBudgetUtilisation(budgets, now)).toEqual({
        totalSpentEur: 18,
        totalLimitEur: 150,
      });
    });

    it('produces zero spent when allocations are empty', () => {
      const budgets = [
        {
          status: 'ACTIVE',
          periodStart: '2026-01-01',
          periodEnd: '2026-12-31',
          totalLimitEur: 100,
          allocations: [],
        },
      ];
      expect(currentBudgetUtilisation(budgets, now)).toEqual({
        totalSpentEur: 0,
        totalLimitEur: 100,
      });
    });

    it('treats a budget covering the whole period as current when now is the boundary', () => {
      const atStart = new Date('2026-01-01T00:00:00Z');
      const budgets = [
        {
          status: 'ACTIVE',
          periodStart: '2026-01-01',
          periodEnd: '2026-12-31',
          totalLimitEur: 100,
          allocations: [],
        },
      ];
      expect(currentBudgetUtilisation(budgets, atStart)).toEqual({
        totalSpentEur: 0,
        totalLimitEur: 100,
      });
    });

    it('parses string-typed EUR values from Prisma Decimal', () => {
      const budgets = [
        {
          status: 'ACTIVE',
          periodStart: '2026-01-01',
          periodEnd: '2026-12-31',
          totalLimitEur: '250.00',
          allocations: [{ spentEur: '12.50' }],
        },
      ];
      expect(currentBudgetUtilisation(budgets, now)).toEqual({
        totalSpentEur: 12.5,
        totalLimitEur: 250,
      });
    });
  });

  describe('connectedIntegrationCount', () => {
    it('counts only CONNECTED integrations', () => {
      const integrations = [
        { status: 'CONNECTED' },
        { status: 'DISCONNECTED' },
        { status: 'CONNECTED' },
        { status: 'ERROR' },
      ];
      expect(connectedIntegrationCount(integrations)).toBe(2);
    });

    it('returns null when data is unavailable', () => {
      expect(connectedIntegrationCount(null)).toBeNull();
      expect(connectedIntegrationCount(undefined)).toBeNull();
    });
  });
});
