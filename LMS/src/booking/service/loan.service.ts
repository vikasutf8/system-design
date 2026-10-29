import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { emitAvailabilityChanged } from '../../common/availability/availability.events';
import { LibraryConfigService } from '../../common/config/library.config';
import { TransactionService } from '../../common/database/transaction.service';
import {
  DomainNotFoundException,
  HoldExpiredException,
  HoldNotActiveException,
  NoCopyAvailableException,
} from '../../common/exceptions/domain.exception';
import { CopyStatus, HoldStatus, LoanStatus } from '../domain/enums';
import { LoanCreatedEvent, LoanReturnedEvent } from '../domain/events';
import { Loan } from '../domain/loan.entity';
import { OutboxService } from '../outbox/outbox.service';
import { CopyRepository } from '../repository/copy.repository';
import { HoldRepository } from '../repository/hold.repository';
import { LoanRepository } from '../repository/loan.repository';
import { CopyAllocator } from './copy-allocator.service';
import { FineService, FineView } from './fine.service';

export interface ReturnResult {
  loan: Loan;
  fine: FineView | null;
}

/**
 * Checkout / return (arch.md 5.4, LLD 6.3 / 6.4).
 *
 * Both paths lock the hold, loan and copy rows with FOR UPDATE, so checkout
 * and the hold-expiry job cannot interleave. Transitions go through the entity
 * state machine before touching the database.
 */
@Injectable()
export class LoanService {
  constructor(
    private readonly transactions: TransactionService,
    private readonly loans: LoanRepository,
    private readonly holds: HoldRepository,
    private readonly copies: CopyRepository,
    private readonly allocator: CopyAllocator,
    private readonly fineService: FineService,
    private readonly outbox: OutboxService,
    private readonly config: LibraryConfigService,
    private readonly events: EventEmitter2,
  ) {}

  /** Librarian scans the copy for a member with an ACTIVE, unexpired hold. */
  async checkout(holdId: string): Promise<ReturnResult> {
    const loan = await this.transactions.run(async (manager) => {
      const hold = await this.holds.lockById(manager, holdId);
      if (!hold) {
        throw new DomainNotFoundException('HOLD_NOT_FOUND', `Hold ${holdId} was not found`);
      }
      if (hold.status !== HoldStatus.ACTIVE) throw new HoldNotActiveException(holdId);
      if (!hold.expiresAt || hold.expiresAt.getTime() <= Date.now()) {
        throw new HoldExpiredException(holdId);
      }
      if (!hold.copyId) throw new HoldNotActiveException(holdId);

      const copy = await this.copies.lockById(manager, hold.copyId);
      if (!copy) {
        throw new DomainNotFoundException('COPY_NOT_FOUND', `Copy ${hold.copyId} was not found`);
      }

      // HELD -> CHECKED_OUT: availability count is unchanged.
      copy.transitionTo(CopyStatus.CHECKED_OUT);
      await manager.save(copy);
      hold.fulfill();
      await manager.save(hold);

      const now = new Date();
      const created = Loan.open(
        copy.copyId,
        hold.userId,
        now,
        new Date(now.getTime() + this.config.loanPeriodMs),
      );
      await manager.save(created);

      const event: LoanCreatedEvent = {
        type: 'LoanCreated',
        loanId: created.loanId,
        userId: created.userId,
        copyId: created.copyId,
        bookId: copy.bookId,
        dueAt: created.dueAt.toISOString(),
        occurredAt: now.toISOString(),
      };
      await this.outbox.add(this.config.loanTopic, created.userId, event as unknown as Record<string, unknown>);

      return created;
    });

    return { loan, fine: null };
  }

  /** Walk-in checkout without a hold (LLD 6.3). Uses the same claim query. */
  async walkInCheckout(userId: string, bookId: string): Promise<ReturnResult> {
    const evictedBookIds: string[] = [];

    const loan = await this.transactions.run(async (manager) => {
      const userRows: Array<{ status: string }> = await manager.query(
        `SELECT status FROM users WHERE user_id = $1`,
        [userId],
      );
      if (!userRows[0]) {
        throw new DomainNotFoundException('USER_NOT_FOUND', `User ${userId} was not found`);
      }
      if (userRows[0].status !== 'ACTIVE') {
        throw new DomainNotFoundException('USER_INACTIVE', `User ${userId} is not active`);
      }

      const copyId = await this.allocator.claimAvailableCopy(manager, bookId);
      if (!copyId) throw new NoCopyAvailableException(bookId);

      const copy = await this.copies.lockById(manager, copyId);
      if (!copy) throw new DomainNotFoundException('COPY_NOT_FOUND', `Copy ${copyId} was not found`);
      copy.transitionTo(CopyStatus.CHECKED_OUT);
      await manager.save(copy);

      const now = new Date();
      const created = Loan.open(
        copyId,
        userId,
        now,
        new Date(now.getTime() + this.config.loanPeriodMs),
      );
      await manager.save(created);

      const event: LoanCreatedEvent = {
        type: 'LoanCreated',
        loanId: created.loanId,
        userId,
        copyId,
        bookId: copy.bookId,
        dueAt: created.dueAt.toISOString(),
        occurredAt: now.toISOString(),
      };
      await this.outbox.add(this.config.loanTopic, userId, event as unknown as Record<string, unknown>);
      evictedBookIds.push(copy.bookId);
      return created;
    });

    emitAvailabilityChanged(this.events, evictedBookIds);
    return { loan, fine: null };
  }

  async returnCopy(loanId: string): Promise<ReturnResult> {
    const evictedBookIds: string[] = [];

    const result = await this.transactions.run(async (manager) => {
      const loan = await this.loans.lockById(manager, loanId);
      if (!loan) {
        throw new DomainNotFoundException('LOAN_NOT_FOUND', `Loan ${loanId} was not found`);
      }

      // Idempotent: a second return returns the stored result.
      if (loan.status === LoanStatus.RETURNED) {
        return {
          loan,
          fine: await this.fineService.findByLoan(loan.loanId),
          bookId: null as string | null,
        };
      }

      const now = new Date();
      loan.markReturned(now);
      await manager.save(loan);

      // Finalize any overdue fine before releasing the copy.
      const fine = await this.fineService.finalizeFine(manager, loan, now);

      const copy = await this.copies.lockById(manager, loan.copyId);
      if (!copy) {
        throw new DomainNotFoundException('COPY_NOT_FOUND', `Copy ${loan.copyId} was not found`);
      }

      // CHECKED_OUT -> HELD (next waiter) or AVAILABLE.
      await this.allocator.assignOrRelease(manager, copy);

      const event: LoanReturnedEvent = {
        type: 'LoanReturned',
        loanId: loan.loanId,
        userId: loan.userId,
        copyId: loan.copyId,
        bookId: copy.bookId,
        returnedAt: now.toISOString(),
        occurredAt: now.toISOString(),
      };
      await this.outbox.add(this.config.loanTopic, loan.userId, event as unknown as Record<string, unknown>);
      evictedBookIds.push(copy.bookId);

      return { loan, fine, bookId: copy.bookId };
    });

    emitAvailabilityChanged(this.events, evictedBookIds);
    return { loan: result.loan, fine: result.fine };
  }
}
