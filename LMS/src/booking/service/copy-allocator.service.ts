import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { LibraryConfigService } from '../../common/config/library.config';
import { BookCopy } from '../domain/book-copy.entity';
import { CopyStatus } from '../domain/enums';
import { HoldReadyEvent } from '../domain/events';
import { OutboxService } from '../outbox/outbox.service';
import { CopyRepository } from '../repository/copy.repository';
import { HoldRepository } from '../repository/hold.repository';

/**
 * Owns the two copy allocation paths from LLD 6.1:
 *   - claimAvailableCopy: atomic conditional update (AVAILABLE -> HELD)
 *   - assignOrRelease: when a copy becomes free, hand it to the oldest queued
 *     hold or make it AVAILABLE again.
 *
 * Callers must already be inside a transaction and hold the copy row lock.
 */
@Injectable()
export class CopyAllocator {
  constructor(
    private readonly copies: CopyRepository,
    private readonly holds: HoldRepository,
    private readonly outbox: OutboxService,
    private readonly config: LibraryConfigService,
  ) {}

  claimAvailableCopy(manager: EntityManager, bookId: string): Promise<string | null> {
    return this.copies.claimAvailableCopy(manager, bookId);
  }

  async assignOrRelease(manager: EntityManager, copy: BookCopy): Promise<void> {
    const next = await this.holds.lockNextQueued(manager, copy.bookId);

    if (!next) {
      copy.transitionTo(CopyStatus.AVAILABLE);
      await manager.save(copy);
      return;
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.holdTtlMs);

    // Promote the waiter and keep the copy HELD for them.
    next.activate(copy.copyId, expiresAt);
    await manager.save(next);

    copy.transitionTo(CopyStatus.HELD);
    await manager.save(copy);

    // "Hold ready" notification goes through the same outbox transaction.
    const event: HoldReadyEvent = {
      type: 'HoldReady',
      holdId: next.holdId,
      userId: next.userId,
      bookId: copy.bookId,
      copyId: copy.copyId,
      expiresAt: expiresAt.toISOString(),
      occurredAt: now.toISOString(),
    };
    await this.outbox.add(this.config.holdTopic, next.userId, event as unknown as Record<string, unknown>);
  }
}
