import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { AuthenticatedUser, UserRole } from '../../common/auth/roles';
import { AccountService } from '../service/account.service';
import { fineView, holdView, loanResponse } from './mappers';

@ApiTags('account')
@Controller('users/me')
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Get('loans')
  @Roles(UserRole.MEMBER, UserRole.LIBRARIAN, UserRole.ADMIN)
  @ApiOperation({ summary: 'My loans' })
  async myLoans(@CurrentUser() user: AuthenticatedUser) {
    const loans = await this.accountService.myLoans(user.userId);
    return loans.map((loan) => loanResponse(loan));
  }

  @Get('holds')
  @Roles(UserRole.MEMBER, UserRole.LIBRARIAN, UserRole.ADMIN)
  @ApiOperation({ summary: 'My holds and waitlist positions' })
  async myHolds(@CurrentUser() user: AuthenticatedUser) {
    const rows = await this.accountService.myHolds(user.userId);
    return rows.map((row) => holdView(row.hold, row.queuePosition));
  }

  @Get('fines')
  @Roles(UserRole.MEMBER, UserRole.LIBRARIAN, UserRole.ADMIN)
  @ApiOperation({ summary: 'My fines (live accrual included)' })
  async myFines(@CurrentUser() user: AuthenticatedUser) {
    const fines = await this.accountService.myFines(user.userId);
    return fines.map((fine) => fineView(fine));
  }
}
