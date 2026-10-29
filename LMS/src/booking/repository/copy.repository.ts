import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { BookCopy } from '../domain/book-copy.entity';

/**
 * Raw SQL repository for the concurrency-critical copy operations.
 * Plain repository methods cannot express the conditional "claim one row"
 * update from arch.md 5.3, so this is intentionally SQL.
 */
@Injectable()
export class CopyRepository {
  /**
   * Atomically claims one AVAILABLE copy for a book.
   *
   * UPDATE ... WHERE copy_id = (SELECT ... FOR UPDATE SKIP LOCKED)
   * RETURNING copy_id
   *
   * If two members race for the last copy, only one UPDATE returns a row; the
   * other gets an empty array and joins the waitlist. This is the database
   * rule that makes double booking impossible.
   */
  async claimAvailableCopy(manager: EntityManager, bookId: string): Promise<string | null> {
    const rows: Array<{ copy_id: string }> = await manager.query(
      `UPDATE book_copy
          SET status = 'HELD',
              version = version + 1,
              updated_at = now()
        WHERE copy_id = (
              SELECT copy_id
                FROM book_copy
               WHERE book_id = $1
                 AND status = 'AVAILABLE'
               ORDER BY copy_id
               LIMIT 1
               FOR UPDATE SKIP LOCKED)
        RETURNING copy_id`,
      [bookId],
    );
    return rows[0]?.copy_id ?? null;
  }

  /** Locks a copy row with SELECT ... FOR UPDATE. */
  async lockById(manager: EntityManager, copyId: string): Promise<BookCopy | null> {
    return manager.findOne(BookCopy, {
      where: { copyId },
      lock: { mode: 'pessimistic_write' },
    });
  }

  /**
   * Inserts `count` new AVAILABLE copies in one statement.
   * Used by POST /catalog/books/:id/copies.
   */
  async createAvailableCopies(
    manager: EntityManager,
    bookId: string,
    count: number,
  ): Promise<string[]> {
    const rows: Array<{ copy_id: string }> = await manager.query(
      `INSERT INTO book_copy (copy_id, book_id, status, version, updated_at)
       SELECT gen_random_uuid(), $1, 'AVAILABLE', 0, now()
         FROM generate_series(1, $2)
       RETURNING copy_id`,
      [bookId, count],
    );
    return rows.map((row) => row.copy_id);
  }
}
