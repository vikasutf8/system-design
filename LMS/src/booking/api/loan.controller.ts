import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/auth/auth.decorators';
import { UserRole } from '../../common/auth/roles';
import { LoanService } from '../service/loan.service';
import { CheckoutRequest, WalkInCheckoutRequest } from './dto/checkout.dto';
import { loanResponse } from './mappers';

@ApiTags('loans')
@Controller('loans')
export class LoanController {
  constructor(private readonly loanService: LoanService) {}

  /** POST /loans - checkout the copy assigned to an ACTIVE hold. */
  @Post()
  @Roles(UserRole.LIBRARIAN, UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Checkout a held copy' })
  async checkout(@Body() request: CheckoutRequest) {
    const result = await this.loanService.checkout(request.holdId);
    return loanResponse(result.loan, result.fine);
  }

  /** POST /loans/walk-in - checkout any free copy without a hold. */
  @Post('walk-in')
  @Roles(UserRole.LIBRARIAN, UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Walk-in checkout without a hold' })
  async walkIn(@Body() request: WalkInCheckoutRequest) {
    const result = await this.loanService.walkInCheckout(request.userId, request.bookId);
    return loanResponse(result.loan, result.fine);
  }

  /** POST /loans/{id}/return - idempotent, finalizes fines and promotes waiters. */
  @Post(':loanId/return')
  @Roles(UserRole.LIBRARIAN, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Return a copy' })
  async returnCopy(@Param('loanId', new ParseUUIDPipe()) loanId: string) {
    const result = await this.loanService.returnCopy(loanId);
    return loanResponse(result.loan, result.fine);
  }
}
