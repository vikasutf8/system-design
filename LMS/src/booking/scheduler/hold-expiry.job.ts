import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { HoldService } from '../service/hold.service';

/**
 * Hold expiry job (LLD 6.10): every minute, expire ACTIVE holds past
 * expires_at in batches of 100 and pass each free copy to the next waiter.
 *
 * `FOR UPDATE SKIP LOCKED` lets several instances run at the same time without
 * blocking or double-processing. Each batch is its own transaction.
 */
@Injectable()
export class HoldExpiryJob {
  private readonly logger = new Logger(HoldExpiryJob.name);
  private running = false;

  constructor(private readonly holdService: HoldService) {}

  @Interval(60_000)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const processed = await this.runOnce();
      if (processed > 0) this.logger.log(`Expired ${processed} hold(s)`);
    } catch (error) {
      this.logger.error(`Hold expiry job failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Processes full batches until the queue is drained. Also used by admin. */
  async runOnce(): Promise<number> {
    let total = 0;
    let processed: number;
    do {
      processed = await this.holdService.expireDueHolds(100);
      total += processed;
    } while (processed === 100);
    return total;
  }
}
