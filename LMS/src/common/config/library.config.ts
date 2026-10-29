import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Strongly typed access to every knob in .env.dev.
 * Keeping defaults here means the code is runnable even if a variable is
 * missing, while Docker Compose remains the single place that supplies values.
 */
@Injectable()
export class LibraryConfigService {
  constructor(private readonly config: ConfigService) {}

  private str(key: string, fallback: string): string {
    return this.config.get<string>(key) ?? fallback;
  }

  private num(key: string, fallback: number): number {
    const parsed = Number(this.config.get<string>(key));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  get nodeEnv(): string {
    return this.str('NODE_ENV', 'dev');
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get port(): number {
    return this.num('PORT', 3000);
  }

  get jwtSecret(): string {
    return this.str('JWT_SECRET', 'dev-only-jwt-secret-change-me-in-production');
  }

  get jwtExpiresIn(): string {
    return this.str('JWT_EXPIRES_IN', '12h');
  }

  /** Converts "12h" / "30m" / "3600s" to seconds for jsonwebtoken. */
  get jwtExpiresInSeconds(): number {
    const raw = this.jwtExpiresIn.trim();
    const match = /^(\d+)([smhd])$/.exec(raw);
    if (!match) return 43_200;
    const amount = Number(match[1]);
    const factor = match[2] === 's' ? 1 : match[2] === 'm' ? 60 : match[2] === 'h' ? 3_600 : 86_400;
    return amount * factor;
  }

  get databaseUrl(): string {
    return this.str('DATABASE_URL', 'postgresql://lms:lms@localhost:5432/lms');
  }

  get mongoUri(): string {
    return this.str('MONGO_URI', 'mongodb://localhost:27017/lms?replicaSet=rs0');
  }

  get redisUrl(): string {
    return this.str('REDIS_URL', 'redis://localhost:6379');
  }

  get kafkaBrokers(): string[] {
    return this.str('KAFKA_BROKERS', 'localhost:29092')
      .split(',')
      .map((broker) => broker.trim())
      .filter(Boolean);
  }

  get kafkaClientId(): string {
    return this.str('KAFKA_CLIENT_ID', 'lms-monolith');
  }

  get elasticsearchNode(): string {
    return this.str('ELASTICSEARCH_NODE', 'http://localhost:9200');
  }

  get esBooksAlias(): string {
    return this.str('ES_BOOKS_ALIAS', 'books');
  }

  get esBooksIndex(): string {
    return this.str('ES_BOOKS_INDEX', 'books_v1');
  }

  get catalogTopic(): string {
    return this.str('CATALOG_TOPIC', 'catalog.lms.books');
  }

  get catalogDlqTopic(): string {
    return this.str('CATALOG_DLQ_TOPIC', 'catalog.books.dlq');
  }

  get holdTopic(): string {
    return this.str('HOLD_TOPIC', 'hold.events');
  }

  get loanTopic(): string {
    return this.str('LOAN_TOPIC', 'loan.events');
  }

  // ----- business rules (LLD 5.3) -------------------------------------------

  get holdTtlMs(): number {
    return this.num('HOLD_TTL_HOURS', 24) * 3_600_000;
  }

  get loanPeriodMs(): number {
    return this.num('LOAN_PERIOD_DAYS', 14) * 86_400_000;
  }

  get dailyFineRate(): number {
    return this.num('DAILY_FINE_RATE', 0.5);
  }

  get maxFine(): number {
    return this.num('MAX_FINE', 20);
  }

  get maxActiveHoldsPerUser(): number {
    return this.num('MAX_ACTIVE_HOLDS_PER_USER', 5);
  }

  get blockHoldsAboveFine(): number {
    return this.num('BLOCK_HOLDS_ABOVE_FINE', 10);
  }

  // ----- cache and paging ---------------------------------------------------

  get availabilityTtlSeconds(): number {
    return this.num('AVAILABILITY_TTL_SECONDS', 60);
  }

  get searchCacheTtlSeconds(): number {
    return this.num('SEARCH_CACHE_TTL_SECONDS', 45);
  }

  get bookCacheTtlSeconds(): number {
    return this.num('BOOK_CACHE_TTL_SECONDS', 300);
  }

  get maxSearchSize(): number {
    return this.num('MAX_SEARCH_SIZE', 50);
  }

  get maxSearchWindow(): number {
    return this.num('MAX_SEARCH_WINDOW', 1000);
  }
}
