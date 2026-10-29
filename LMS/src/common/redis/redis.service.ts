import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { LibraryConfigService } from '../config/library.config';

/**
 * Thin wrapper over ioredis.
 *
 * Redis is cache-aside only (arch.md 5.8): every caller must be able to fall
 * back to Postgres/Elasticsearch. To make that possible the client is created
 * with `enableOfflineQueue: false`, so a command fails immediately when Redis
 * is down instead of hanging the request. Callers catch and degrade.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor(private readonly config: LibraryConfigService) {
    this.client = new Redis(this.config.redisUrl, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: (attempt) => Math.min(attempt * 500, 3_000),
    });
    this.client.on('error', (error) => {
      this.logger.warn(`Redis error: ${error.message}`);
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
      this.logger.log('Redis connected');
    } catch (error) {
      // Cache loss must slow the system down, not stop it.
      this.logger.warn(
        `Redis unavailable at startup (${(error as Error).message}); cache operations will fall back`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.client.disconnect();
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.set(key, value, 'EX', ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async mget(keys: string[]): Promise<(string | null)[]> {
    if (keys.length === 0) return [];
    return this.client.mget(keys);
  }

  /** Atomic set-if-not-exists, used for idempotent Kafka consumers. */
  async setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }
}
