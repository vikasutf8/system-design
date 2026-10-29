import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { KafkaService } from '../../common/kafka/kafka.service';

/**
 * Outbox relay (LLD 6.8).
 *
 * Every 500 ms it opens a transaction, locks up to 100 unpublished rows with
 * FOR UPDATE SKIP LOCKED, publishes them to Kafka and stamps published_at.
 * A crash after send but before commit republishes the same rows, so delivery
 * is at least once. Consumers use the envelope's eventId to deduplicate.
 *
 * The Kafka key is stored in payload.key (e.g. userId) for per-member ordering.
 */
@Injectable()
export class OutboxRelayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopped = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly kafka: KafkaService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), 500);
    this.logger.log('Outbox relay started (fixed delay 500 ms)');
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      await this.publishBatch();
    } catch (error) {
      // Kafka outage: rows stay unpublished and the next tick retries.
      this.logger.warn(`Outbox publish failed, will retry: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Exposed for tests and the admin endpoint. Returns the number published. */
  async publishBatch(): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const rows: Array<{ id: string; topic: string; payload: any }> = await manager.query(
        `SELECT id, topic, payload
           FROM outbox
          WHERE published_at IS NULL
          ORDER BY id
          LIMIT 100
          FOR UPDATE SKIP LOCKED`,
      );
      if (rows.length === 0) return 0;

      for (const row of rows) {
        const key: string | null = row.payload?.key ?? null;
        const event = row.payload?.event ?? row.payload;
        const envelope = {
          eventId: String(row.id),
          topic: row.topic,
          key,
          payload: event,
          occurredAt: new Date().toISOString(),
        };
        await this.kafka.send(row.topic, key, JSON.stringify(envelope));
      }

      await manager.query(
        `UPDATE outbox
            SET published_at = now()
          WHERE id = ANY($1::bigint[])`,
        [rows.map((row) => row.id)],
      );

      this.logger.log(`Published ${rows.length} outbox event(s) to Kafka`);
      return rows.length;
    });
  }
}
