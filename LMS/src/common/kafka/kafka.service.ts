import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Consumer, Kafka, Producer } from 'kafkajs';
import { LibraryConfigService } from '../config/library.config';

/**
 * KafkaJS wrapper shared by the outbox relay and the consumers.
 *
 * The producer is connected lazily: if Kafka is unavailable the relay keeps
 * retrying on its next tick, because the outbox rows remain unpublished in
 * PostgreSQL. Nothing is lost (arch.md 5.5).
 */
@Injectable()
export class KafkaService implements OnModuleDestroy {
  private readonly logger = new Logger(KafkaService.name);
  private readonly kafka: Kafka;
  private producerPromise?: Promise<Producer>;

  constructor(private readonly config: LibraryConfigService) {
    this.kafka = new Kafka({
      clientId: this.config.kafkaClientId,
      brokers: this.config.kafkaBrokers,
      retry: {
        initialRetryTime: 300,
        retries: 5,
      },
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.producerPromise) return;
    try {
      const producer = await this.producerPromise;
      await producer.disconnect();
    } catch {
      // nothing to do during shutdown
    }
  }

  /** Lazily connects a single producer; a failed connect is retried later. */
  async getProducer(): Promise<Producer> {
    if (!this.producerPromise) {
      this.producerPromise = (async () => {
        const producer = this.kafka.producer({ allowAutoTopicCreation: true });
        await producer.connect();
        this.logger.log('Kafka producer connected');
        return producer;
      })().catch((error) => {
        this.producerPromise = undefined;
        throw error;
      });
    }
    return this.producerPromise;
  }

  /** Publishes a JSON string with a 5 s timeout (LLD 6.8). */
  async send(topic: string, key: string | null, value: string): Promise<void> {
    const producer = await this.getProducer();
    await producer.send({
      topic,
      acks: -1,
      timeout: 5_000,
      messages: [{ key: key ?? undefined, value }],
    });
  }

  createConsumer(groupId: string): Consumer {
    return this.kafka.consumer({
      groupId,
      allowAutoTopicCreation: true,
      sessionTimeout: 30_000,
    });
  }

  /** Used by the health endpoint; does not hang if Kafka is down. */
  async ping(): Promise<boolean> {
    const admin = this.kafka.admin();
    try {
      await Promise.race([
        (async () => {
          await admin.connect();
          await admin.describeCluster();
        })(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2_000)),
      ]);
      return true;
    } catch {
      return false;
    } finally {
      await admin.disconnect().catch(() => undefined);
    }
  }
}
