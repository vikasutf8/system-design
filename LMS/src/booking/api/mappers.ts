import { FineView } from '../service/fine.service';
import { HoldResult } from '../service/hold.service';
import { Loan } from '../domain/loan.entity';

/** API contracts from LLD section 9. */

export function holdResponse(result: HoldResult) {
  return {
    holdId: result.hold.holdId,
    bookId: result.hold.bookId,
    status: result.hold.status,
    expiresAt: result.hold.expiresAt?.toISOString() ?? null,
    queuePosition: result.queuePosition,
  };
}

export function loanResponse(loan: Loan, fine?: FineView | null) {
  const body: Record<string, unknown> = {
    loanId: loan.loanId,
    copyId: loan.copyId,
    userId: loan.userId,
    checkedOutAt: loan.checkedOutAt.toISOString(),
    dueAt: loan.dueAt.toISOString(),
    returnedAt: loan.returnedAt?.toISOString() ?? null,
    status: loan.status,
  };
  if (fine !== undefined) {
    body.fine = fine
      ? {
          daysOverdue: fine.daysOverdue,
          amount: fine.amount,
          status: fine.status,
        }
      : null;
  }
  return body;
}

export function holdView(hold: HoldResult['hold'], queuePosition: number | null) {
  return {
    holdId: hold.holdId,
    bookId: hold.bookId,
    userId: hold.userId,
    copyId: hold.copyId,
    status: hold.status,
    createdAt: hold.createdAt.toISOString(),
    expiresAt: hold.expiresAt?.toISOString() ?? null,
    queuePosition,
  };
}

export function fineView(fine: FineView) {
  return {
    fineId: fine.fineId,
    loanId: fine.loanId,
    daysOverdue: fine.daysOverdue,
    amount: fine.amount,
    status: fine.status,
    dueAt: fine.dueAt.toISOString(),
    returnedAt: fine.returnedAt?.toISOString() ?? null,
    updatedAt: fine.updatedAt.toISOString(),
  };
}
