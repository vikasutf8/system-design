import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookingModule } from './booking/booking.module';
import { BookCopy } from './booking/domain/book-copy.entity';
import { Fine } from './booking/domain/fine.entity';
import { Hold } from './booking/domain/hold.entity';
import { Loan } from './booking/domain/loan.entity';
import { OutboxEvent } from './booking/domain/outbox-event.entity';
import { User } from './booking/domain/user.entity';
import { CatalogModule } from './catalog/catalog.module';
import { AuthModule } from './common/auth/auth.module';
import { JwtAuthGuard } from './common/auth/jwt-auth.guard';
import { RolesGuard } from './common/auth/roles.guard';
import { CommonModule } from './common/common.module';
import { LibraryConfigService } from './common/config/library.config';
import { GlobalExceptionFilter } from './common/exceptions/global-exception.filter';
import { HealthModule } from './common/health/health.module';
import { TraceIdMiddleware } from './common/http/trace-id.middleware';
import { NotificationModule } from './notification/notification.module';
import { SearchModule } from './search/search.module';

/**
 * Monolith composition root.
 *
 * Every module still has the boundaries from LLD section 1 (booking, catalog,
 * search, and later notification). They share one process and one deployment,
 * but only through services/events, not by reaching into each other's tables.
 */
@Module({
  imports: [
    // .env.dev is the single development environment file.
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.dev', '.env'],
    }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),

    // PostgreSQL booking write model.
    TypeOrmModule.forRootAsync({
      inject: [LibraryConfigService],
      useFactory: (config: LibraryConfigService) => ({
        type: 'postgres' as const,
        url: config.databaseUrl,
        entities: [BookCopy, Hold, Loan, Fine, OutboxEvent, User],
        synchronize: false, // schema is owned by init/postgres/01-schema.sql
        logging: false,
        retryAttempts: 30,
        retryDelay: 2_000,
        extra: {
          max: 20,
          statement_timeout: 2_000,
        },
      }),
    }),

    // MongoDB catalog source of truth.
    MongooseModule.forRootAsync({
      inject: [LibraryConfigService],
      useFactory: (config: LibraryConfigService) => ({
        uri: config.mongoUri,
        retryAttempts: 30,
        retryDelay: 2_000,
        serverSelectionTimeoutMS: 5_000,
      }),
    }),

    CommonModule,
    AuthModule,
    HealthModule,
    BookingModule,
    CatalogModule,
    SearchModule,
    NotificationModule,
  ],
  providers: [
    // Authentication + role checks run on every route unless @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // Single error shape for the API (LLD 9.4).
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(TraceIdMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
