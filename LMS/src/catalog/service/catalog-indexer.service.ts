import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Consumer } from 'kafkajs';
import { LibraryConfigService } from '../../common/config/library.config';
import { ElasticsearchService } from '../../common/elasticsearch/elasticsearch.service';
import { KafkaService } from '../../common/kafka/kafka.service';
import { changeVersion, toBookDocument } from '../domain/book.mapper';

/**
 * Search index sync consumer (arch.md 5.7, LLD 8.2).
 *
 * Debezium MongoDB -> Kafka topic `catalog.lms.books` -> this consumer -> ES.
 *
 * Guarantees:
 * - document id = bookId, so replays overwrite the same document.
 * - external versioning = Debezium ts_ms, so out-of-order events are rejected.
 * - manual offset commit only after Elasticsearch accepts the write.
 * - transient failures retried with backoff; after 5 attempts the raw event
 *   goes to catalog.books.dlq and the offset is committed so the pipeline
 *   does not stall forever.
 */
@Injectable()
export class CatalogIndexerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CatalogIndexerService.name);
  private consumer?: Consumer;
  private stopped = false;
  private readonly stopSignal: Promise<void>;
  private resolveStop?: () => void;

  constructor(
    private readonly kafka: KafkaService,
    private readonly es: ElasticsearchService,
    private readonly config: LibraryConfigService,
  ) {
    this.stopSignal = new Promise<void>((resolve) => {
      this.resolveStop = resolve;
    });
  }

  onModuleInit(): void {
    // Do not block application bootstrap on Kafka/ES availability.
    void this.startLoop();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    this.resolveStop?.();
    await this.consumer?.disconnect().catch(() => undefined);
  }

  private async startLoop(): Promise<void> {
    while (!this.stopped) {
      const consumer = this.kafka.createConsumer('es-indexer');
      try {
        await consumer.connect();
        await consumer.subscribe({
          topic: this.config.catalogTopic,
          fromBeginning: true,
        });
        this.consumer = consumer;
        this.logger.log(`Listening for catalog changes on ${this.config.catalogTopic}`);

        await consumer.run({
          autoCommit: false,
          eachMessage: async ({ topic, partition, message }) => {
            await this.processWithRetry(message.value);
            // Offset is committed only after ES accepted (or DLQ accepted) it.
            await consumer.commitOffsets([
              {
                topic,
                partition,
                offset: (BigInt(message.offset) + 1n).toString(),
              },
            ]);
          },
        });

        // KafkaJS run() resolves as soon as the runner has joined the group
        // (it does not block). Stay parked here so this loop creates exactly
        // one consumer; disconnecting on shutdown resolves the signal.
        await this.stopSignal;
      } catch (error) {
        if (this.stopped) break;
        this.logger.warn(
          `ES indexer consumer error: ${(error as Error).message}; reconnecting in 5s`,
        );
        await consumer.disconnect().catch(() => undefined);
        await delay(5_000);
      } finally {
        this.consumer = undefined;
        await consumer.disconnect().catch(() => undefined);
      }
    }
  }

  /** Retries transient ES errors, ignores version conflicts, then DLQs. */
  private async processWithRetry(raw: Buffer | null): Promise<void> {
    if (!raw) return; // tombstone dropped by the Debezium SMT

    const parsed = JSON.parse(raw.toString()) as Record<string, unknown>;
    const bookId = String(parsed._id ?? parsed.book_id ?? parsed.bookId ?? '');
    if (!bookId) {
      this.logger.warn('Skipping catalog event without a book id');
      return;
    }

    const deleted = parsed.__deleted === true || parsed.__deleted === 'true';
    const version = changeVersion(parsed);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        if (deleted) {
          await this.es.deleteBook(bookId);
          this.logger.log(`Deleted ${bookId} from Elasticsearch (CDC)`);
        } else {
          await this.es.indexBook(bookId, toBookDocument(parsed), version);
          this.logger.log(`Indexed ${bookId} in Elasticsearch (version ${version})`);
        }
        return;
      } catch (error) {
        if (this.es.isVersionConflict(error)) {
          // Older event than the document already in ES: safe to ignore.
          this.logger.warn(`Ignored stale catalog event for ${bookId}`);
          return;
        }

        if (attempt === 5) {
          this.logger.error(
            `Failed to index ${bookId} after 5 attempts: ${(error as Error).message}`,
          );
          await this.publishToDlq(bookId, parsed, error);
          return;
        }

        await delay(200 * 2 ** (attempt - 1));
      }
    }
  }

  private async publishToDlq(
    bookId: string,
    rawEvent: Record<string, unknown>,
    error: unknown,
  ): Promise<void> {
    // If Kafka itself is down this throws, the offset is not committed, and
    // the record is retried after the consumer reconnects.
    await this.kafka.send(
      this.config.catalogDlqTopic,
      bookId,
      JSON.stringify({
        bookId,
        error: (error as Error).message,
        failedAt: new Date().toISOString(),
        rawEvent,
      }),
    );
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
