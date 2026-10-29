import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Loan } from '../domain/loan.entity';

@Injectable()
export class LoanRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Locks a loan; a second return waits and then sees RETURNED (idempotent). */
  async lockById(manager: EntityManager, loanId: string): Promise<Loan | null> {
    return manager.findOne(Loan, {
      where: { loanId },
      lock: { mode: 'pessimistic_write' },
    });
  }

  async findById(loanId: string): Promise<Loan | null> {
    return this.dataSource.getRepository(Loan).findOne({ where: { loanId } });
  }

  async findByUser(userId: string): Promise<Loan[]> {
    return this.dataSource.getRepository(Loan).find({
      where: { userId },
      order: { checkedOutAt: 'DESC' },
    });
  }
}
