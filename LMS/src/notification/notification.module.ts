import { Module } from '@nestjs/common';
import { NotificationConsumer } from './notification.consumer';

@Module({
  providers: [NotificationConsumer],
})
export class NotificationModule {}
