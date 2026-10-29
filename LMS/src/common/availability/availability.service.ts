import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LibraryConfigService } from '../config/library.config';
import { ServiceUnavailableException } from '../exceptions/domain.exception';
import { RedisService } from '../redis/redis.service';

/**
 * Availability is a derived read model. The number of AVAILABLE copies lives
 * in PostgreSQL; `avail:{bookId}` caches it for 60 s in Redis. The booking
 * service invalidates the key after commit, and the TTL heals missed deletes
 * (arch.md 5.5 / 5.8).
 */
@Injectable()
export class AvailabilityService {
  private readonly logger = new Logger(AvailabilityService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly redis: RedisService,
    private readonly config: LibraryConfigService,
  ) {}

  async counts(bookIds: string[]): Promise<Map<string, number>> {
    const uniqueIds = [...new Set(bookIds.filter(Boolean))];
    const result = new Map<string, number>();
    if (uniqueIds.length === 0) return result;

    const keys = uniqueIds.map((id) => `avail:${id}`);
    const missing: string[] = [];

    // 1. Try the cache. A Redis outage is never fatal.
    let cached: (string | null)[] | null = null;
    try {
      cached = await this.redis.mget(keys);
    } catch (error) {
      this.logger.warn(`Availability cache read failed: ${(error as Error).message}`);
    }

    if (cached && cached.length === uniqueIds.length) {
      uniqueIds.forEach((id, index) => {
        const value = cached?.[index];
        if (value !== null && value !== undefined) {
          result.set(id, Number(value));
        } else {
          missing.push(id);
        }
      });
    } else {
      missing.push(...uniqueIds);
    }

    // 2. Read misses from PostgreSQL in one grouped query.
    if (missing.length > 0) {
      const fromDb = await this.countAvailableFromDb(missing);
      for (const id of missing) {
        const count = fromDb.get(id) ?? 0;
        result.set(id, count);
        try {
          await this.redis.set(
            `avail:${id}`,
            String(count),
            this.config.availabilityTtlSeconds,
          );
        } catch {
          // Cache is optional; ignore write failures.
        }
      }
    }

    return result;
  }

  async countForBook(bookId: string): Promise<number> {
    const counts = await this.counts([bookId]);
    return counts.get(bookId) ?? 0;
  }

  private async countAvailableFromDb(bookIds: string[]): Promise<Map<string, number>> {
    try {
      const rows: Array<{ book_id: string; available: number }> = await this.dataSource.query(
        `SELECT book_id, COUNT(*)::int AS available
           FROM book_copy
          WHERE book_id = ANY($1::text[])
            AND status = 'AVAILABLE'
          GROUP BY book_id`,
        [bookIds],
      );
      return new Map(rows.map((row) => [row.book_id, Number(row.available)]));
    } catch (error) {
      this.logger.error(`Availability fallback query failed: ${(error as Error).message}`);
      throw new ServiceUnavailableException('Availability lookup is temporarily unavailable');
    }
  }
}
