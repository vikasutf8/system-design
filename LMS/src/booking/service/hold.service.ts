import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuthenticatedUser, UserRole } from '../../common/auth/roles';
import { LibraryConfigService } from '../../common/config/library.config';
import { TransactionService } from '../../common/database/transaction.service';
import {
  DomainNotFoundException,
  DuplicateHoldException,
  ForbiddenException,
  HoldExpiredException,
  HoldNotActiveException,
  isUniqueViolation,
} from '../../common/exceptions/domain.exception';
import { emitAvailabilityChanged } from '../../common/availability/availability.events';
import {
  HoldCancelledEvent,
  HoldExpiredEvent,
  HoldPlacedEvent,
} from '../domain/events';
import { Hold } from '../domain/hold.entity';
import { CopyStatus, HoldStatus } from '../domain/enums';
import { OutboxService } from '../outbox/outbox.service';
import { CopyRepository } from '../repository/copy.repository';
import { HoldRepository } from '../repository/hold.repository';
import { CopyAllocator } from './copy-allocator.service';
import { EligibilityService } from './eligibility.service';

export interface HoldResult {
  hold: Hold;
  queuePosition: number | null;
}

/**
 * Hold lifecycle (arch.md 5.3, LLD 6.2 / 6.5).
 *
 * No double booking is guaranteed by the conditional copy UPDATE + partial
 * unique index, not by application-level locks. Redis is only touched after
 * commit, through the availability observer.
 */
@Injectable()
export class HoldService {
  private readonly logger = new Logger(HoldService.name);

  constructor(
    private readonly transactions: TransactionService,
    private readonly holds: HoldRepository,
    private readonly copies: CopyRepository,
    private readonly allocator: CopyAllocator,
    private readonly eligibility: EligibilityService,
    private readonly outbox: OutboxService,
    private readonly config: LibraryConfigService,
    private readonly events: EventEmitter2,
  ) {}

  async placeHold(userId: string, bookId: string, idempotencyKey: string): Promise<HoldResult> {
    // 1. Replay: the same (user, key) returns the original hold.
    const replay = await this.holds.findByUserAndKey(userId, idempotencyKey);
    if (replay) return this.toResult(replay);

    let placed: Hold;
    try {
      placed = await this.transactions.run(async (manager) => {
        // 2. Business rules before claiming a scarce copy.
        await this.eligibility.check(manager, userId, bookId);

        // 3. Conditional claim; empty result means "join the waitlist".
        const now = new Date();
        const copyId = await this.allocator.claimAvailableCopy(manager, bookId);
        const hold = copyId
          ? Hold.active(
              userId,
              bookId,
              copyId,
              idempotencyKey,
              now,
              new Date(now.getTime() + this.config.holdTtlMs),
            )
          : Hold.queued(userId, bookId, idempotencyKey, now);

        // INSERT (not save) so a unique violation surfaces inside this
        // try/catch and the whole transaction, including the copy claim,
        // rolls back.
        await manager.insert(Hold, hold);

        const event: HoldPlacedEvent = {
          type: 'HoldPlaced',
          holdId: hold.holdId,
          userId,
          bookId,
          copyId: hold.copyId,
          status: hold.status,
          expiresAt: hold.expiresAt?.toISOString() ?? null,
          occurredAt: now.toISOString(),
        };
        await this.outbox.add(this.config.holdTopic, userId, event as unknown as Record<string, unknown>);
        return hold;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        // Same idempotency key raced with itself: return the winner.
        const existing = await this.holds.findByUserAndKey(userId, idempotencyKey);
        if (existing) return this.toResult(existing);
        // Same member already has an open hold for this book (different key).
        throw new DuplicateHoldException();
      }
      throw error;
    }

    // 4. Cache invalidation only after COMMIT.
    emitAvailabilityChanged(this.events, [bookId]);
    return this.toResult(placed);
  }

  async cancelHold(actor: AuthenticatedUser, holdId: string): Promise<void> {
    const evictBookIds: string[] = [];

    await this.transactions.run(async (manager) => {
      const hold = await this.holds.lockById(manager, holdId);
      if (!hold) {
        throw new DomainNotFoundException('HOLD_NOT_FOUND', `Hold ${holdId} was not found`);
      }
      if (actor.role === UserRole.MEMBER && hold.userId !== actor.userId) {
        throw new ForbiddenException('A member may only cancel their own hold');
      }
      if (hold.status === HoldStatus.CANCELLED) return; // idempotent
      if (hold.status !== HoldStatus.ACTIVE && hold.status !== HoldStatus.QUEUED) {
        throw new HoldNotActiveException(holdId);
      }

      const hadCopy = hold.status === HoldStatus.ACTIVE && hold.copyId !== null;
      hold.cancel();
      await manager.save(hold);

      if (hadCopy && hold.copyId) {
        // Free the copy and pass it to the next waiter, if any.
        const copy = await this.copies.lockById(manager, hold.copyId);
        if (copy) {
          await this.allocator.assignOrRelease(manager, copy);
          evictBookIds.push(copy.bookId);
        }
      }

      const event: HoldCancelledEvent = {
        type: 'HoldCancelled',
        holdId: hold.holdId,
        userId: hold.userId,
        bookId: hold.bookId,
        occurredAt: new Date().toISOString(),
      };
      await this.outbox.add(this.config.holdTopic, hold.userId, event as unknown as Record<string, unknown>);
    });

    emitAvailabilityChanged(this.events, evictBookIds);
  }

  /**
   * Expires a batch of holds. Each call is its own transaction; the job loops
   * while a full batch was processed. SKIP LOCKED lets several instances run
   * safely (LLD 6.10).
   */
  async expireDueHolds(batchSize: number): Promise<number> {
    const evictBookIds: string[] = [];

    const processed = await this.transactions.run(async (manager) => {
      const due = await this.holds.lockExpiredActive(manager, new Date(), batchSize);

      for (const hold of due) {
        if (hold.status !== HoldStatus.ACTIVE) continue;

        hold.expire();
        await manager.save(hold);

        if (hold.copyId) {
          const copy = await this.copies.lockById(manager, hold.copyId);
          if (copy && copy.status === CopyStatus.HELD) {
            await this.allocator.assignOrRelease(manager, copy);
          }
          evictBookIds.push(hold.bookId);
        }

        const event: HoldExpiredEvent = {
          type: 'HoldExpired',
          holdId: hold.holdId,
          userId: hold.userId,
          bookId: hold.bookId,
          occurredAt: new Date().toISOString(),
        };
        await this.outbox.add(this.config.holdTopic, hold.userId, event as unknown as Record<string, unknown>);
      }

      return due.length;
    });

    emitAvailabilityChanged(this.events, evictBookIds);
    return processed;
  }

  /** Used by checkout to validate the hold is still usable. */
  assertUsable(hold: Hold): void {
    if (hold.status !== HoldStatus.ACTIVE) throw new HoldNotActiveException(hold.holdId);
    if (!hold.expiresAt || hold.expiresAt.getTime() <= Date.now()) {
      throw new HoldExpiredException(hold.holdId);
    }
  }

  private async toResult(hold: Hold): Promise<HoldResult> {
    return { hold, queuePosition: await this.holds.queuePosition(hold) };
  }
}
