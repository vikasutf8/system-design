import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { LibraryConfigService } from '../../common/config/library.config';
import {
  DomainNotFoundException,
  DuplicateHoldException,
  ForbiddenException,
  HoldLimitReachedException,
  UnpaidFinesException,
} from '../../common/exceptions/domain.exception';
import { User } from '../domain/user.entity';
import { HoldRepository } from '../repository/hold.repository';

/**
 * Business rules that reject a hold before a copy is claimed (LLD 6.2):
 *   1. account must be ACTIVE
 *   2. one open hold per member/book
 *   3. at most maxActiveHoldsPerUser open holds
 *   4. unpaid fines above the block threshold
 *
 * The duplicate rule is also enforced by uq_active_hold_per_user_book, which
 * covers the race between two concurrent requests from different devices.
 */
@Injectable()
export class EligibilityService {
  constructor(
    private readonly holds: HoldRepository,
    private readonly config: LibraryConfigService,
  ) {}

  async check(manager: EntityManager, userId: string, bookId: string): Promise<void> {
    const user = await manager.findOne(User, { where: { userId } });
    if (!user) {
      throw new DomainNotFoundException('USER_NOT_FOUND', `User ${userId} was not found`);
    }
    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException('Member account is not active');
    }

    if (await this.holds.hasOpenHold(manager, userId, bookId)) {
      throw new DuplicateHoldException();
    }

    const openHolds = await this.holds.countOpenByUser(manager, userId);
    if (openHolds >= this.config.maxActiveHoldsPerUser) {
      throw new HoldLimitReachedException(this.config.maxActiveHoldsPerUser);
    }

    const rows: Array<{ total: number }> = await manager.query(
      `SELECT COALESCE(SUM(amount), 0)::float8 AS total
         FROM fines
        WHERE user_id = $1
          AND status IN ('ACCRUING', 'FINAL')`,
      [userId],
    );
    const unpaid = Number(rows[0]?.total ?? 0);
    if (unpaid > this.config.blockHoldsAboveFine) {
      throw new UnpaidFinesException(this.config.blockHoldsAboveFine);
    }
  }
}
