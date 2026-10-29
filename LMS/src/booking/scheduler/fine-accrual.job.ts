import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { FineService } from '../service/fine.service';

/**
 * Nightly fine accrual (arch.md 3.5 / LLD 6.10). Runs safely on every
 * instance because the set-based upsert is idempotent.
 */
@Injectable()
export class FineAccrualJob {
  private readonly logger = new Logger(FineAccrualJob.name);

  constructor(private readonly fineService: FineService) {}

  @Cron('0 30 1 * * *')
  async tick(): Promise<void> {
    try {
      await this.runOnce();
    } catch (error) {
      this.logger.error(`Fine accrual job failed: ${(error as Error).message}`);
    }
  }

  async runOnce(): Promise<number> {
    return this.fineService.accrueOverdueFines();
  }
}
