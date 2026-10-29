import { randomUUID } from 'crypto';
import { Column, Entity, PrimaryColumn } from 'typeorm';
import { IllegalStateTransitionException } from '../../common/exceptions/domain.exception';
import { HoldStatus } from './enums';

/**
 * A hold is either ACTIVE (a copy is assigned and reserved for the member) or
 * QUEUED (waitlist, copy_id is NULL). The partial unique index in PostgreSQL
 * guarantees one open hold per member/book.
 */
@Entity('holds')
export class Hold {
  @PrimaryColumn({ type: 'uuid', name: 'hold_id' })
  holdId: string;

  @Column({ type: 'text', name: 'book_id' })
  bookId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'uuid', name: 'copy_id', nullable: true })
  copyId: string | null;

  @Column({ type: 'text' })
  status: HoldStatus;

  @Column({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @Column({ type: 'timestamptz', name: 'expires_at', nullable: true })
  expiresAt: Date | null;

  @Column({ type: 'text', name: 'idempotency_key' })
  idempotencyKey: string;

  static active(
    userId: string,
    bookId: string,
    copyId: string,
    idempotencyKey: string,
    now: Date,
    expiresAt: Date,
  ): Hold {
    const hold = new Hold();
    hold.holdId = randomUUID();
    hold.userId = userId;
    hold.bookId = bookId;
    hold.copyId = copyId;
    hold.status = HoldStatus.ACTIVE;
    hold.createdAt = now;
    hold.expiresAt = expiresAt;
    hold.idempotencyKey = idempotencyKey;
    return hold;
  }

  static queued(
    userId: string,
    bookId: string,
    idempotencyKey: string,
    now: Date,
  ): Hold {
    const hold = new Hold();
    hold.holdId = randomUUID();
    hold.userId = userId;
    hold.bookId = bookId;
    hold.copyId = null;
    hold.status = HoldStatus.QUEUED;
    hold.createdAt = now;
    hold.expiresAt = null;
    hold.idempotencyKey = idempotencyKey;
    return hold;
  }

  /** Promote the oldest queued hold when a copy becomes free. */
  activate(copyId: string, expiresAt: Date): void {
    this.requireStatus(HoldStatus.QUEUED, 'activate');
    this.copyId = copyId;
    this.expiresAt = expiresAt;
    this.status = HoldStatus.ACTIVE;
  }

  cancel(): void {
    if (this.status !== HoldStatus.ACTIVE && this.status !== HoldStatus.QUEUED) {
      throw new IllegalStateTransitionException('hold', this.status, HoldStatus.CANCELLED);
    }
    this.status = HoldStatus.CANCELLED;
  }

  expire(): void {
    this.requireStatus(HoldStatus.ACTIVE, 'expire');
    this.status = HoldStatus.EXPIRED;
  }

  fulfill(): void {
    this.requireStatus(HoldStatus.ACTIVE, 'fulfill');
    this.status = HoldStatus.FULFILLED;
  }

  private requireStatus(expected: HoldStatus, action: string): void {
    if (this.status !== expected) {
      throw new IllegalStateTransitionException(
        `hold.${action}`,
        this.status,
        expected,
      );
    }
  }
}
