import { Inject, Injectable } from '@nestjs/common';
import { LibraryConfigService } from '../../common/config/library.config';

export const FINE_POLICY = Symbol('FINE_POLICY');

/** Strategy interface: swap fine rules without touching LoanService (LLD 3). */
export interface FinePolicy {
  calculate(dueAt: Date, until: Date): number;
}

/** Whole overdue days, rounded up. 1 second late = 1 day (LLD 6.6). */
export function overdueDays(dueAt: Date, until: Date): number {
  const seconds = Math.floor((until.getTime() - dueAt.getTime()) / 1000);
  if (seconds <= 0) return 0;
  return Math.ceil(seconds / 86_400);
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * fine = min(overdue_days * daily_rate, max_fine)
 * The nightly SQL in FineService must produce the same value; a parity test
 * lives in daily-rate-fine-policy.spec.ts.
 */
@Injectable()
export class DailyRateFinePolicy implements FinePolicy {
  constructor(@Inject(LibraryConfigService) private readonly config: LibraryConfigService) {}

  calculate(dueAt: Date, until: Date): number {
    const days = overdueDays(dueAt, until);
    if (days === 0) return 0;
    return roundMoney(Math.min(days * this.config.dailyFineRate, this.config.maxFine));
  }
}
