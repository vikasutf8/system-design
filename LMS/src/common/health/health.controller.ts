import { Controller, Get, Res } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Connection } from 'mongoose';
import { DataSource } from 'typeorm';
import { Public } from '../auth/auth.decorators';
import { ElasticsearchService } from '../elasticsearch/elasticsearch.service';
import { KafkaService } from '../kafka/kafka.service';
import { RedisService } from '../redis/redis.service';

type CheckState = 'up' | 'down';

/**
 * Liveness/readiness for the container and for a load balancer.
 * PostgreSQL and MongoDB are critical (source-of-truth stores); Redis,
 * Elasticsearch and Kafka are reported but only degrade the service.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    @InjectConnection() private readonly mongo: Connection,
    private readonly redis: RedisService,
    private readonly elasticsearch: ElasticsearchService,
    private readonly kafka: KafkaService,
  ) {}

  @Public()
  @Get('live')
  @ApiOperation({ summary: 'Liveness probe' })
  live() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Public()
  @Get()
  @ApiOperation({ summary: 'Readiness probe with dependency checks' })
  async readiness(@Res({ passthrough: true }) response: Response) {
    const [postgres, mongo, redis, elasticsearch, kafka] = await Promise.all([
      this.checkPostgres(),
      this.checkMongo(),
      this.checkRedis(),
      this.checkElasticsearch(),
      this.checkKafka(),
    ]);

    const criticalDown = postgres === 'down' || mongo === 'down';
    response.status(criticalDown ? 503 : 200);
    return {
      status: criticalDown ? 'down' : 'ok',
      timestamp: new Date().toISOString(),
      checks: { postgres, mongo, redis, elasticsearch, kafka },
    };
  }

  private async checkPostgres(): Promise<CheckState> {
    try {
      await this.dataSource.query('SELECT 1');
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async checkMongo(): Promise<CheckState> {
    try {
      if (!this.mongo.db) return 'down';
      await this.mongo.db.admin().ping();
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async checkRedis(): Promise<CheckState> {
    return (await this.redis.ping()) ? 'up' : 'down';
  }

  private async checkElasticsearch(): Promise<CheckState> {
    return (await this.elasticsearch.ping()) ? 'up' : 'down';
  }

  private async checkKafka(): Promise<CheckState> {
    return (await this.kafka.ping()) ? 'up' : 'down';
  }
}
