import { Injectable } from '@nestjs/common';
import { TransactionService } from '../../common/database/transaction.service';

/**
 * Writes an outbox row *inside the caller's transaction* (LLD 6.8).
 *
 * This mirrors Spring's `@Transactional(propagation = MANDATORY)`: if a
 * developer calls add() outside a transaction we fail immediately instead of
 * silently creating an event that is not atomic with the state change.
 *
 * payload = { key, event } so the relay knows the Kafka partition key even
 * though the outbox table itself only stores topic + JSONB payload.
 */
@Injectable()
export class OutboxService {
  constructor(private readonly transactions: TransactionService) {}

  async add(topic: string, key: string | null, event: Record<string, unknown>): Promise<void> {
    if (!this.transactions.inTransaction()) {
      throw new Error('OutboxService.add must be called inside a booking transaction');
    }
    await this.transactions.manager.query(
      `INSERT INTO outbox (topic, payload, created_at)
       VALUES ($1, $2::jsonb, now())`,
      [topic, JSON.stringify({ key, event })],
    );
  }
}
