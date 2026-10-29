import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { LibraryConfigService } from '../../common/config/library.config';
import { Loan } from '../domain/loan.entity';
import { FineStatus } from '../domain/enums';
import { FINE_POLICY, FinePolicy, overdueDays, roundMoney } from './fine-policy';

export interface FineView {
  fineId: string | null;
  loanId: string;
  userId: string;
  daysOverdue: number;
  amount: number;
  status: FineStatus;
  dueAt: Date;
  returnedAt: Date | null;
  updatedAt: Date;
}

/**
 * Overdue fine processing (arch.md 5.6 / LLD 6.6).
 * - On return: finalize the amount and mark the fine FINAL.
 * - Nightly: one set-based upsert of ACCRUING fines for open overdue loans.
 * - On read: compute live amounts for open overdue loans the job has not seen.
 */
@Injectable()
export class FineService {
  private readonly logger = new Logger(FineService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: LibraryConfigService,
    @Inject(FINE_POLICY) private readonly policy: FinePolicy,
  ) {}

  async finalizeFine(manager: EntityManager, loan: Loan, returnedAt: Date): Promise<FineView | null> {
    const days = overdueDays(loan.dueAt, returnedAt);
    const amount = this.policy.calculate(loan.dueAt, returnedAt);
    if (amount <= 0) return null;

    const rows: FineView[] = await manager.query(
      `INSERT INTO fines (fine_id, loan_id, user_id, days_overdue, amount, status, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'FINAL', now())
       ON CONFLICT (loan_id) DO UPDATE
          SET days_overdue = EXCLUDED.days_overdue,
              amount       = EXCLUDED.amount,
              status       = 'FINAL',
              updated_at   = now()
       RETURNING fine_id        AS "fineId",
                 loan_id        AS "loanId",
                 user_id        AS "userId",
                 days_overdue   AS "daysOverdue",
                 amount::float8 AS "amount",
                 status         AS "status",
                 now()          AS "dueAt",
                 NULL           AS "returnedAt",
                 updated_at     AS "updatedAt"`,
      [loan.loanId, loan.userId, days, amount],
    );

    const fine = rows[0];
    if (!fine) return null;
    fine.dueAt = loan.dueAt;
    fine.returnedAt = returnedAt;
    return fine;
  }

  /**
   * Nightly accrual, exactly the LLD SQL shape. One statement covers all open
   * overdue loans, and the WHERE clause prevents overwriting PAID/WAIVED/FINAL
   * rows. It is idempotent, so multiple job instances are safe.
   */
  async accrueOverdueFines(): Promise<number> {
    const rows: Array<{ fine_id: string }> = await this.dataSource.query(
      `INSERT INTO fines (fine_id, loan_id, user_id, days_overdue, amount, status, updated_at)
       SELECT gen_random_uuid(), l.loan_id, l.user_id,
              CEIL(EXTRACT(EPOCH FROM (now() - l.due_at)) / 86400)::int,
              LEAST(CEIL(EXTRACT(EPOCH FROM (now() - l.due_at)) / 86400) * $1, $2),
              'ACCRUING', now()
         FROM loans l
        WHERE l.status = 'OPEN' AND l.due_at < now()
       ON CONFLICT (loan_id) DO UPDATE
          SET days_overdue = EXCLUDED.days_overdue,
              amount       = EXCLUDED.amount,
              updated_at   = now()
          WHERE fines.status = 'ACCRUING'
       RETURNING fine_id`,
      [this.config.dailyFineRate, this.config.maxFine],
    );
    this.logger.log(`Fine accrual touched ${rows.length} rows`);
    return rows.length;
  }

  async currentFines(userId: string): Promise<FineView[]> {
    const now = new Date();

    const persisted: Array<{
      fineId: string;
      loanId: string;
      userId: string;
      daysOverdue: number;
      amount: number;
      status: FineStatus;
      dueAt: Date;
      returnedAt: Date | null;
      updatedAt: Date;
    }> = await this.dataSource.query(
      `SELECT f.fine_id      AS "fineId",
              f.loan_id      AS "loanId",
              f.user_id      AS "userId",
              f.days_overdue AS "daysOverdue",
              f.amount::float8 AS "amount",
              f.status       AS "status",
              l.due_at       AS "dueAt",
              l.returned_at  AS "returnedAt",
              f.updated_at   AS "updatedAt"
         FROM fines f
         JOIN loans l ON l.loan_id = f.loan_id
        WHERE f.user_id = $1`,
      [userId],
    );

    // Compute live accrual so the view is correct even when the nightly job
    // has not run yet (arch.md 5.6 "on read").
    const live: Array<{
      loanId: string;
      userId: string;
      dueAt: Date;
      returnedAt: Date | null;
    }> = await this.dataSource.query(
      `SELECT l.loan_id AS "loanId",
              l.user_id AS "userId",
              l.due_at  AS "dueAt",
              l.returned_at AS "returnedAt"
         FROM loans l
         LEFT JOIN fines f ON f.loan_id = l.loan_id
        WHERE l.user_id = $1
          AND l.status = 'OPEN'
          AND l.due_at < now()
          AND f.fine_id IS NULL`,
      [userId],
    );

    const computed: FineView[] = live.map((loan) => {
      const days = overdueDays(loan.dueAt, now);
      return {
        fineId: null,
        loanId: loan.loanId,
        userId: loan.userId,
        daysOverdue: days,
        amount: roundMoney(Math.min(days * this.config.dailyFineRate, this.config.maxFine)),
        status: FineStatus.ACCRUING,
        dueAt: loan.dueAt,
        returnedAt: loan.returnedAt,
        updatedAt: now,
      };
    });

    return [...persisted, ...computed].sort(
      (left, right) => left.dueAt.getTime() - right.dueAt.getTime(),
    );
  }

  async findByLoan(loanId: string): Promise<FineView | null> {
    const rows: Array<{
      fineId: string;
      loanId: string;
      userId: string;
      daysOverdue: number;
      amount: number;
      status: FineStatus;
      updatedAt: Date;
    }> = await this.dataSource.query(
      `SELECT fine_id AS "fineId",
              loan_id AS "loanId",
              user_id AS "userId",
              days_overdue AS "daysOverdue",
              amount::float8 AS "amount",
              status,
              updated_at AS "updatedAt"
         FROM fines
        WHERE loan_id = $1`,
      [loanId],
    );
    const row = rows[0];
    if (!row) return null;
    return { ...row, dueAt: new Date(), returnedAt: null };
  }
}
