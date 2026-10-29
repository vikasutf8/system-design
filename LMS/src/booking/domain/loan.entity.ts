import { randomUUID } from 'crypto';
import { Column, Entity, PrimaryColumn } from 'typeorm';
import { IllegalStateTransitionException } from '../../common/exceptions/domain.exception';
import { LoanStatus } from './enums';

/** An open loan has exactly one copy; a partial unique index enforces that. */
@Entity('loans')
export class Loan {
  @PrimaryColumn({ type: 'uuid', name: 'loan_id' })
  loanId: string;

  @Column({ type: 'uuid', name: 'copy_id' })
  copyId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'timestamptz', name: 'checked_out_at' })
  checkedOutAt: Date;

  @Column({ type: 'timestamptz', name: 'due_at' })
  dueAt: Date;

  @Column({ type: 'timestamptz', name: 'returned_at', nullable: true })
  returnedAt: Date | null;

  @Column({ type: 'text' })
  status: LoanStatus;

  static open(copyId: string, userId: string, now: Date, dueAt: Date): Loan {
    const loan = new Loan();
    loan.loanId = randomUUID();
    loan.copyId = copyId;
    loan.userId = userId;
    loan.checkedOutAt = now;
    loan.dueAt = dueAt;
    loan.returnedAt = null;
    loan.status = LoanStatus.OPEN;
    return loan;
  }

  markReturned(at: Date): void {
    if (this.status !== LoanStatus.OPEN) {
      throw new IllegalStateTransitionException('loan', this.status, LoanStatus.RETURNED);
    }
    this.returnedAt = at;
    this.status = LoanStatus.RETURNED;
  }
}
