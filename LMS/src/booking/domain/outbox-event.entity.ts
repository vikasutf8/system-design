import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Outbox row written in the same transaction as the booking state change.
 * The relay publishes it to Kafka and stamps published_at (LLD 6.8).
 *
 * payload shape: { "key": "<kafka key>", "event": { ...domain event... } }
 */
export interface OutboxPayload {
  key: string | null;
  event: Record<string, unknown>;
}

@Entity('outbox')
export class OutboxEvent {
  @PrimaryGeneratedColumn({ type: 'bigint', name: 'id' })
  id: string; // bigint is returned as a string by pg

  @Column({ type: 'text' })
  topic: string;

  @Column({ type: 'jsonb' })
  payload: OutboxPayload;

  @Column({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @Column({ type: 'timestamptz', name: 'published_at', nullable: true })
  publishedAt: Date | null;

  markPublished(at: Date): void {
    this.publishedAt = at;
  }
}
