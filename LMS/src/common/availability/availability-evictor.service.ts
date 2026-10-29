import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { RedisService } from '../redis/redis.service';
import { AVAILABILITY_CHANGED, AvailabilityChangedEvent } from './availability.events';

/**
 * Cache-aside invalidation (LLD 6.9).
 *
 * Runs after the booking transaction commits. If Redis fails we only log:
 * the 60-second TTL will fix the stale value and booking correctness is
 * unaffected because writes always re-check PostgreSQL.
 */
@Injectable()
export class AvailabilityEvictor {
  private readonly logger = new Logger(AvailabilityEvictor.name);

  constructor(private readonly redis: RedisService) {}

  @OnEvent(AVAILABILITY_CHANGED)
  async handle(event: AvailabilityChangedEvent): Promise<void> {
    try {
      await this.redis.del(`avail:${event.bookId}`);
    } catch (error) {
      this.logger.warn(
        `Redis evict failed for ${event.bookId}; TTL will heal it (${(error as Error).message})`,
      );
    }
  }
}
