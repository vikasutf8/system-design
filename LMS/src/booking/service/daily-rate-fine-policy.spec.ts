import { LibraryConfigService } from '../../common/config/library.config';
import { DailyRateFinePolicy, overdueDays } from './fine-policy';

describe('DailyRateFinePolicy (LLD 6.6 / 12.1)', () => {
  const dueAt = new Date('2026-01-01T00:00:00.000Z');
  const policy = new DailyRateFinePolicy({
    dailyFineRate: 0.5,
    maxFine: 20,
  } as unknown as LibraryConfigService);

  it('returns zero when not overdue', () => {
    expect(policy.calculate(dueAt, dueAt)).toBe(0);
    expect(policy.calculate(dueAt, new Date('2025-12-31T23:59:59.000Z'))).toBe(0);
  });

  it('rounds one second late up to a full day', () => {
    const oneSecondLate = new Date(dueAt.getTime() + 1_000);
    expect(overdueDays(dueAt, oneSecondLate)).toBe(1);
    expect(policy.calculate(dueAt, oneSecondLate)).toBe(0.5);
  });

  it('charges exactly one day at exactly 24 hours', () => {
    const exactlyOneDay = new Date(dueAt.getTime() + 86_400_000);
    expect(policy.calculate(dueAt, exactlyOneDay)).toBe(0.5);
  });

  it('charges three days for a 3-day delay', () => {
    const threeDays = new Date(dueAt.getTime() + 3 * 86_400_000);
    expect(policy.calculate(dueAt, threeDays)).toBe(1.5);
  });

  it('caps the amount at maxFine', () => {
    const hundredDays = new Date(dueAt.getTime() + 100 * 86_400_000);
    expect(policy.calculate(dueAt, hundredDays)).toBe(20);
  });
});
