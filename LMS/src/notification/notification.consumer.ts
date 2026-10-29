import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Consumer } from 'kafkajs';
import { LibraryConfigService } from '../common/config/library.config';
import { KafkaService } from '../common/kafka/kafka.service';
import { RedisService } from '../common/redis/redis.service';

interface EventEnvelope {
  eventId: string;
  topic: string;
  key: string | null;
  payload: Record<string, unknown> & { type?: string; userId?: string };
  occurredAt: string;
}

/**
 * Notification service (arch.md 3.6).
 *
 * Consumes hold/loan events from Kafka and simulates email/SMS delivery.
 * Delivery is at least once, so the consumer is idempotent: the outbox event
 * id is stored in Redis with SET NX for 24 h before the notification is sent.
 * If Redis is down we process anyway; a duplicate notification is preferable
 * to dropping one.
 */
@Injectable()
export class NotificationConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationConsumer.name);
  private consumer?: Consumer;
  private stopped = false;
  private readonly stopSignal: Promise<void>;
  private resolveStop?: () => void;

  constructor(
    private readonly kafka: KafkaService,
    private readonly redis: RedisService,
    private readonly config: LibraryConfigService,
  ) {
    this.stopSignal = new Promise<void>((resolve) => {
      this.resolveStop = resolve;
    });
  }

  onModuleInit(): void {
    void this.startLoop();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    this.resolveStop?.();
    await this.consumer?.disconnect().catch(() => undefined);
  }

  private async startLoop(): Promise<void> {
    while (!this.stopped) {
      const consumer = this.kafka.createConsumer('notification-service');
      try {
        await consumer.connect();
        await consumer.subscribe({
          topics: [this.config.holdTopic, this.config.loanTopic],
          fromBeginning: true,
        });
        this.consumer = consumer;
        this.logger.log(
          `Listening on ${this.config.holdTopic} and ${this.config.loanTopic}`,
        );

        await consumer.run({
          autoCommit: false,
          eachMessage: async ({ topic, partition, message }) => {
            if (message.value) {
              await this.handle(message.value);
            }
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
          `Notification consumer error: ${(error as Error).message}; reconnecting in 5s`,
        );
        await consumer.disconnect().catch(() => undefined);
        await delay(5_000);
      } finally {
        this.consumer = undefined;
        await consumer.disconnect().catch(() => undefined);
      }
    }
  }

  private async handle(raw: Buffer): Promise<void> {
    let envelope: EventEnvelope;
    try {
      envelope = JSON.parse(raw.toString()) as EventEnvelope;
    } catch {
      this.logger.warn('Skipping malformed notification event');
      return;
    }
    if (!envelope.eventId) return;

    // Idempotent consumer: SET NX on the outbox event id.
    try {
      const firstDelivery = await this.redis.setIfAbsent(
        `notification:${envelope.eventId}`,
        '1',
        86_400,
      );
      if (!firstDelivery) {
        this.logger.debug(`Duplicate event ${envelope.eventId} ignored`);
        return;
      }
    } catch {
      // Redis down: send anyway (at-least-once semantics).
    }

    const type = envelope.payload?.type ?? 'Unknown';
    const userId = envelope.payload?.userId ?? envelope.key ?? 'unknown';
    this.logger.log(`[simulated email/sms] user=${userId} event=${type} ${this.describe(envelope)}`);
  }

  private describe(envelope: EventEnvelope): string {
    const payload = envelope.payload ?? {};
    switch (payload.type) {
      case 'HoldReady':
        return `Your hold is ready until ${String(payload.expiresAt ?? 'the deadline')}`;
      case 'HoldPlaced':
        return `Hold placed (${String(payload.status ?? '')}) for book ${String(payload.bookId ?? '')}`;
      case 'HoldCancelled':
        return `Hold cancelled for book ${String(payload.bookId ?? '')}`;
      case 'HoldExpired':
        return `Hold expired for book ${String(payload.bookId ?? '')}`;
      case 'LoanCreated':
        return `Book checked out, due at ${String(payload.dueAt ?? '')}`;
      case 'LoanReturned':
        return `Book returned at ${String(payload.returnedAt ?? '')}`;
      default:
        return `Catalog/domain event ${String(payload.type ?? '')}`;
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
