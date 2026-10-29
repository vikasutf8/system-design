import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { LibraryConfigService } from '../config/library.config';

/**
 * Elasticsearch document mapping (arch.md 5.7).
 *
 * Availability is intentionally absent: it changes on every hold/return and is
 * joined at read time from Redis/Postgres instead.
 */
export const BOOKS_INDEX_MAPPING = {
  properties: {
    book_id: { type: 'keyword' },
    title: {
      type: 'text',
      fields: { keyword: { type: 'keyword', ignore_above: 256 } },
    },
    authors: {
      type: 'text',
      fields: { keyword: { type: 'keyword', ignore_above: 256 } },
    },
    isbn: { type: 'keyword' },
    genres: { type: 'keyword' },
    language: { type: 'keyword' },
    publication_year: { type: 'integer' },
    tags: {
      type: 'text',
      fields: { keyword: { type: 'keyword', ignore_above: 256 } },
    },
    description: { type: 'text' },
    updated_at: { type: 'date' },
  },
} as const;

@Injectable()
export class ElasticsearchService implements OnModuleInit {
  private readonly logger = new Logger(ElasticsearchService.name);
  private readonly es: Client;
  private ready = false;
  private ensurePromise?: Promise<void>;

  constructor(private readonly config: LibraryConfigService) {
    this.es = new Client({
      node: this.config.elasticsearchNode,
      maxRetries: 2,
      requestTimeout: 500,
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureBooksIndex();
    } catch (error) {
      // Search/indexing callers call ensureBooksIndex() again lazily.
      this.logger.warn(
        `Elasticsearch not ready at startup (${(error as Error).message}); will retry`,
      );
    }
  }

  get client(): Client {
    return this.es;
  }

  get alias(): string {
    return this.config.esBooksAlias;
  }

  /**
   * Creates books_v1 + the `books` alias if they do not exist. Safe to call on
   * every index operation; the setup runs once per process.
   */
  async ensureBooksIndex(): Promise<void> {
    if (this.ready) return;
    if (!this.ensurePromise) {
      this.ensurePromise = this.doEnsureIndex().catch((error) => {
        this.ensurePromise = undefined;
        throw error;
      });
    }
    await this.ensurePromise;
  }

  private async doEnsureIndex(): Promise<void> {
    const alias = this.config.esBooksAlias;
    const index = this.config.esBooksIndex;

    const aliasExists = await this.es.indices
      .existsAlias({ name: alias })
      .catch((error) => {
        if (this.isNotFound(error)) return false;
        throw error;
      });

    if (!aliasExists) {
      const indexExists = await this.es.indices.exists({ index }).catch((error) => {
        if (this.isNotFound(error)) return false;
        throw error;
      });

      if (!indexExists) {
        await this.es.indices.create({
          index,
          settings: { number_of_shards: 1, number_of_replicas: 0 },
          mappings: BOOKS_INDEX_MAPPING,
          aliases: { [alias]: {} },
        });
        this.logger.log(`Created Elasticsearch index ${index} with alias ${alias}`);
      } else {
        await this.es.indices.putAlias({ index, name: alias });
      }
    }
    this.ready = true;
  }

  /**
   * Idempotent index write with external versioning (LLD 8.2). The Debezium
   * change timestamp is the version, so an out-of-order/old event is rejected
   * by Elasticsearch with a 409 instead of overwriting newer state.
   */
  async indexBook(bookId: string, document: Record<string, unknown>, version: number): Promise<void> {
    await this.ensureBooksIndex();
    await this.es.index({
      index: this.alias,
      id: bookId,
      document,
      version: Math.max(1, Math.trunc(version)),
      version_type: 'external',
    });
  }

  async deleteBook(bookId: string): Promise<void> {
    await this.ensureBooksIndex();
    try {
      await this.es.delete({ index: this.alias, id: bookId });
    } catch (error) {
      if (!this.isNotFound(error)) throw error;
    }
  }

  /** Performs the raw bulk request used by the reindex job. */
  async bulk(operations: Record<string, unknown>[]): Promise<{ errors: boolean; items: unknown[] }> {
    const response = await this.es.bulk({ operations, refresh: false });
    return { errors: Boolean(response.errors), items: response.items as unknown[] };
  }

  async refresh(index = this.alias): Promise<void> {
    await this.es.indices.refresh({ index });
  }

  /**
   * Atomically moves the `books` alias from the old index to the new one, which
   * is how arch.md 5.7 rebuilds the index without downtime.
   */
  async swapAlias(alias: string, newIndex: string): Promise<void> {
    const actions: Record<string, unknown>[] = [{ add: { index: newIndex, alias } }];
    try {
      const current = await this.es.indices.getAlias({ name: alias });
      for (const existingIndex of Object.keys(current)) {
        if (existingIndex !== newIndex) {
          actions.unshift({ remove: { index: existingIndex, alias } });
        }
      }
    } catch (error) {
      if (!this.isNotFound(error)) throw error;
    }
    await this.es.indices.updateAliases({ actions });
  }

  async ping(): Promise<boolean> {
    try {
      return await this.es.ping();
    } catch {
      return false;
    }
  }

  isNotFound(error: unknown): boolean {
    return this.statusOf(error) === 404;
  }

  isVersionConflict(error: unknown): boolean {
    const body = (error as { body?: { error?: { type?: string } } }).body;
    return this.statusOf(error) === 409 || body?.error?.type === 'version_conflict_engine_exception';
  }

  private statusOf(error: unknown): number | undefined {
    const typed = error as { statusCode?: number; meta?: { statusCode?: number } };
    return typed.statusCode ?? typed.meta?.statusCode;
  }
}
