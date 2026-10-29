import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import { DataSource, EntityManager } from 'typeorm';

interface TransactionContext {
  manager: EntityManager;
}

/**
 * Transaction helper with an AsyncLocalStorage context.
 *
 * - Runs each unit of work with PostgreSQL READ COMMITTED (the default).
 * - Sets `lock_timeout` to 200 ms and `statement_timeout` to 2 s, so a hot row
 *   fails fast instead of piling up requests (LLD sections 10 and 11).
 * - Exposes the active EntityManager to OutboxService, which mimics Spring's
 *   `@Transactional(propagation = MANDATORY)`: writing an outbox row outside a
 *   transaction is a programming error.
 */
@Injectable()
export class TransactionService {
  private readonly storage = new AsyncLocalStorage<TransactionContext>();

  constructor(private readonly dataSource: DataSource) {}

  /** The EntityManager of the current transaction. Throws when misused. */
  get manager(): EntityManager {
    const context = this.storage.getStore();
    if (!context) {
      throw new Error('No active transaction in this execution context');
    }
    return context.manager;
  }

  inTransaction(): boolean {
    return this.storage.getStore() !== undefined;
  }

  async run<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      // Fail a contended row lock quickly (LLD section 10).
      await manager.query("SET LOCAL lock_timeout = '200ms'");
      // Protect the primary from runaway statements (LLD section 11).
      await manager.query("SET LOCAL statement_timeout = '2000ms'");
      return this.storage.run({ manager }, () => work(manager));
    });
  }
}
