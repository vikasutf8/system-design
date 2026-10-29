import {
  Body,
  Controller,
  Delete,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { AuthenticatedUser, UserRole } from '../../common/auth/roles';
import { ValidationDomainException } from '../../common/exceptions/domain.exception';
import { HoldStatus } from '../domain/enums';
import { HoldService } from '../service/hold.service';
import { PlaceHoldRequest } from './dto/place-hold.dto';
import { holdResponse } from './mappers';

@ApiTags('holds')
@Controller('holds')
export class HoldController {
  constructor(private readonly holdService: HoldService) {}

  /**
   * POST /holds
   * 201 when a copy was claimed (ACTIVE), 202 when the member joins the
   * waitlist (QUEUED). The Idempotency-Key header is mandatory.
   */
  @Post()
  @Roles(UserRole.MEMBER)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Place a hold (Idempotency-Key required)' })
  async placeHold(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() request: PlaceHoldRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new ValidationDomainException('Idempotency-Key header is required');
    }

    const result = await this.holdService.placeHold(
      user.userId,
      request.bookId,
      idempotencyKey,
    );

    response.status(
      result.hold.status === HoldStatus.ACTIVE ? HttpStatus.CREATED : HttpStatus.ACCEPTED,
    );
    return holdResponse(result);
  }

  @Delete(':holdId')
  @Roles(UserRole.MEMBER, UserRole.LIBRARIAN, UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel a hold' })
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('holdId', new ParseUUIDPipe()) holdId: string,
  ): Promise<void> {
    await this.holdService.cancelHold(user, holdId);
  }
}
