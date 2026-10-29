import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountController } from './api/account.controller';
import { AdminJobsController } from './api/admin-jobs.controller';
import { HoldController } from './api/hold.controller';
import { LoanController } from './api/loan.controller';
import { BookCopy } from './domain/book-copy.entity';
import { Fine } from './domain/fine.entity';
import { Hold } from './domain/hold.entity';
import { Loan } from './domain/loan.entity';
import { OutboxEvent } from './domain/outbox-event.entity';
import { User } from './domain/user.entity';
import { OutboxRelayService } from './outbox/outbox-relay.service';
import { OutboxService } from './outbox/outbox.service';
import { CopyRepository } from './repository/copy.repository';
import { HoldRepository } from './repository/hold.repository';
import { LoanRepository } from './repository/loan.repository';
import { FineAccrualJob } from './scheduler/fine-accrual.job';
import { HoldExpiryJob } from './scheduler/hold-expiry.job';
import { AccountService } from './service/account.service';
import { CopyAllocator } from './service/copy-allocator.service';
import { CopyService } from './service/copy.service';
import { EligibilityService } from './service/eligibility.service';
import { DailyRateFinePolicy, FINE_POLICY } from './service/fine-policy';
import { FineService } from './service/fine.service';
import { HoldService } from './service/hold.service';
import { LoanService } from './service/loan.service';

/**
 * Booking service (arch.md 3.4): copies, holds, loans, fines and the outbox.
 * Every write is a PostgreSQL transaction; Redis is invalidated after commit.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([BookCopy, Hold, Loan, Fine, OutboxEvent, User]),
  ],
  controllers: [
    HoldController,
    LoanController,
    AccountController,
    AdminJobsController,
  ],
  providers: [
    // repositories
    CopyRepository,
    HoldRepository,
    LoanRepository,
    // domain services
    CopyAllocator,
    EligibilityService,
    HoldService,
    LoanService,
    FineService,
    CopyService,
    AccountService,
    // outbox
    OutboxService,
    OutboxRelayService,
    // scheduling
    HoldExpiryJob,
    FineAccrualJob,
    // fine strategy (LLD design pattern section)
    { provide: FINE_POLICY, useClass: DailyRateFinePolicy },
  ],
  exports: [CopyService],
})
export class BookingModule {}
