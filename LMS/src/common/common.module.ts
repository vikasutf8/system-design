import { Global, Module } from '@nestjs/common';
import { AvailabilityEvictor } from './availability/availability-evictor.service';
import { AvailabilityService } from './availability/availability.service';
import { LibraryConfigService } from './config/library.config';
import { TransactionService } from './database/transaction.service';
import { ElasticsearchService } from './elasticsearch/elasticsearch.service';
import { KafkaService } from './kafka/kafka.service';
import { RedisService } from './redis/redis.service';

/**
 * Cross-cutting infrastructure shared by booking, catalog and search.
 * Global so every feature module can inject these without repeating imports.
 */
@Global()
@Module({
  providers: [
    LibraryConfigService,
    TransactionService,
    RedisService,
    KafkaService,
    ElasticsearchService,
    AvailabilityService,
    AvailabilityEvictor,
  ],
  exports: [
    LibraryConfigService,
    TransactionService,
    RedisService,
    KafkaService,
    ElasticsearchService,
    AvailabilityService,
  ],
})
export class CommonModule {}
