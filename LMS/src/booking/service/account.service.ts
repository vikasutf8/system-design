import { Injectable } from '@nestjs/common';
import { HoldRepository } from '../repository/hold.repository';
import { LoanRepository } from '../repository/loan.repository';
import { FineService, FineView } from './fine.service';

/**
 * Read-only "my account" queries. These can be sent to the PostgreSQL replica
 * at scale (arch.md section 8); in this dev stack they use the primary.
 */
@Injectable()
export class AccountService {
  constructor(
    private readonly holds: HoldRepository,
    private readonly loans: LoanRepository,
    private readonly fines: FineService,
  ) {}

  async myLoans(userId: string) {
    return this.loans.findByUser(userId);
  }

  async myHolds(userId: string) {
    const holds = await this.holds.findByUser(userId);
    return Promise.all(
      holds.map(async (hold) => ({
        hold,
        queuePosition: await this.holds.queuePosition(hold),
      })),
    );
  }

  myFines(userId: string): Promise<FineView[]> {
    return this.fines.currentFines(userId);
  }
}
