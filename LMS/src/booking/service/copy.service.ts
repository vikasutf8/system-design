import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { emitAvailabilityChanged } from '../../common/availability/availability.events';
import { TransactionService } from '../../common/database/transaction.service';
import { CopyRepository } from '../repository/copy.repository';

/**
 * Adds physical copies for a catalog book. Copies live in PostgreSQL while the
 * book metadata lives in MongoDB (LLD 8.1).
 */
@Injectable()
export class CopyService {
  constructor(
    private readonly transactions: TransactionService,
    private readonly copies: CopyRepository,
    private readonly events: EventEmitter2,
  ) {}

  async createCopies(bookId: string, count: number): Promise<string[]> {
    const copyIds = await this.transactions.run((manager) =>
      this.copies.createAvailableCopies(manager, bookId, count),
    );
    // Availability just changed for this book; evict after commit.
    emitAvailabilityChanged(this.events, [bookId]);
    return copyIds;
  }
}
