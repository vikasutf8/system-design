import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/auth/auth.decorators';
import { UserRole } from '../../common/auth/roles';
import { HoldExpiryJob } from '../scheduler/hold-expiry.job';
import { FineAccrualJob } from '../scheduler/fine-accrual.job';
import { OutboxRelayService } from '../outbox/outbox-relay.service';

/**
 * Manual triggers so the scheduled behaviour can be demonstrated without
 * waiting for the nightly cron or the one-minute interval.
 */
@ApiTags('admin')
@Controller('admin')
@Roles(UserRole.ADMIN)
export class AdminJobsController {
  constructor(
    private readonly holdExpiryJob: HoldExpiryJob,
    private readonly fineAccrualJob: FineAccrualJob,
    private readonly outboxRelay: OutboxRelayService,
  ) {}

  @Post('jobs/hold-expiry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run one full hold-expiry pass now' })
  async runHoldExpiry() {
    return { processed: await this.holdExpiryJob.runOnce() };
  }

  @Post('jobs/fine-accrual')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run the nightly fine accrual now' })
  async runFineAccrual() {
    return { touched: await this.fineAccrualJob.runOnce() };
  }

  @Post('outbox/flush')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publish one outbox batch immediately' })
  async flushOutbox() {
    return { published: await this.outboxRelay.publishBatch() };
  }
}
