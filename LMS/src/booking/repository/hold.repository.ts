import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { Hold } from '../domain/hold.entity';
import { HoldStatus } from '../domain/enums';

/**
 * Hold queue access. Queue operations use FOR UPDATE SKIP LOCKED so the
 * expiry job, returns and cancellations never block each other and never hand
 * the same copy to two waiters (LLD 6.1 / section 10).
 */
@Injectable()
export class HoldRepository {
  constructor(private readonly dataSource: DataSource) {}

  async findByUserAndKey(userId: string, idempotencyKey: string): Promise<Hold | null> {
    return this.dataSource.getRepository(Hold).findOne({
      where: { userId, idempotencyKey },
    });
  }

  async findById(holdId: string): Promise<Hold | null> {
    return this.dataSource.getRepository(Hold).findOne({ where: { holdId } });
  }

  /** Locks one hold row; checkout and the expiry job serialise on this row. */
  async lockById(manager: EntityManager, holdId: string): Promise<Hold | null> {
    return manager.findOne(Hold, {
      where: { holdId },
      lock: { mode: 'pessimistic_write' },
    });
  }

  /**
   * Oldest QUEUED hold for a book, locked and skipped if another transaction
   * is already working on it. Returns null when the waitlist is empty.
   */
  async lockNextQueued(manager: EntityManager, bookId: string): Promise<Hold | null> {
    const rows: Array<{ hold_id: string }> = await manager.query(
      `SELECT hold_id
         FROM holds
        WHERE book_id = $1
          AND status = 'QUEUED'
        ORDER BY created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED`,
      [bookId],
    );
    if (rows.length === 0) return null;
    return manager.findOne(Hold, { where: { holdId: rows[0].hold_id } });
  }

  /**
   * Batch of ACTIVE holds whose expiry has passed. Rows are locked with
   * SKIP LOCKED so several job instances each take a different batch.
   */
  async lockExpiredActive(
    manager: EntityManager,
    now: Date,
    batchSize: number,
  ): Promise<Hold[]> {
    const rows: Array<{ hold_id: string }> = await manager.query(
      `SELECT hold_id
         FROM holds
        WHERE status = 'ACTIVE'
          AND expires_at IS NOT NULL
          AND expires_at < $1
        ORDER BY expires_at
        LIMIT $2
        FOR UPDATE SKIP LOCKED`,
      [now, batchSize],
    );
    if (rows.length === 0) return [];

    const holds = await manager.find(Hold, {
      where: { holdId: In(rows.map((row) => row.hold_id)) },
    });
    return holds.sort(
      (left, right) => (left.expiresAt?.getTime() ?? 0) - (right.expiresAt?.getTime() ?? 0),
    );
  }

  async countOpenByUser(manager: EntityManager, userId: string): Promise<number> {
    return manager.count(Hold, {
      where: { userId, status: In([HoldStatus.ACTIVE, HoldStatus.QUEUED]) },
    });
  }

  async hasOpenHold(manager: EntityManager, userId: string, bookId: string): Promise<boolean> {
    const count = await manager.count(Hold, {
      where: {
        userId,
        bookId,
        status: In([HoldStatus.ACTIVE, HoldStatus.QUEUED]),
      },
    });
    return count > 0;
  }

  /** 1-based position in the QUEUED line for a book. */
  async queuePosition(hold: Hold): Promise<number | null> {
    if (hold.status !== HoldStatus.QUEUED) return null;
    const rows: Array<{ position: number }> = await this.dataSource.query(
      `SELECT COUNT(*)::int + 1 AS position
         FROM holds
        WHERE book_id = $1
          AND status = 'QUEUED'
          AND (created_at < $2 OR (created_at = $2 AND hold_id <= $3))`,
      [hold.bookId, hold.createdAt, hold.holdId],
    );
    return rows[0]?.position ?? 1;
  }

  async findByUser(userId: string): Promise<Hold[]> {
    return this.dataSource.getRepository(Hold).find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }
}
