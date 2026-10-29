import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LibraryConfigService } from '../../common/config/library.config';
import {
  BOOKS_INDEX_MAPPING,
  ElasticsearchService,
} from '../../common/elasticsearch/elasticsearch.service';
import { Book, BookRecord } from '../domain/book.schema';
import { changeVersion, toBookDocument } from '../domain/book.mapper';

/**
 * Zero-downtime reindex (arch.md 5.7 / LLD 8.2).
 *
 * Scans MongoDB into a brand-new versioned index, refreshes it, then atomically
 * moves the `books` alias from the old index to the new one. On a bulk error
 * the alias is left untouched.
 */
@Injectable()
export class CatalogReindexService {
  private readonly logger = new Logger(CatalogReindexService.name);
  private running = false;

  constructor(
    @InjectModel(Book.name) private readonly bookModel: Model<Book>,
    private readonly es: ElasticsearchService,
    private readonly config: LibraryConfigService,
  ) {}

  async reindex(): Promise<{
    alias: string;
    oldIndices: string[];
    newIndex: string;
    indexed: number;
  }> {
    if (this.running) {
      throw new Error('A reindex is already running');
    }
    this.running = true;

    const alias = this.config.esBooksAlias;
    const target = `${alias}_reindex_${Date.now()}`;
    let oldIndices: string[] = [];

    try {
      await this.es.ensureBooksIndex();
      try {
        const current = await this.es.client.indices.getAlias({ name: alias });
        oldIndices = Object.keys(current);
      } catch {
        oldIndices = [];
      }

      await this.es.client.indices.create({
        index: target,
        settings: { number_of_shards: 1, number_of_replicas: 0 },
        mappings: BOOKS_INDEX_MAPPING,
      });

      let operations: Record<string, unknown>[] = [];
      let indexed = 0;

      const cursor = this.bookModel.find().lean().cursor();
      for await (const raw of cursor) {
        const record = raw as unknown as BookRecord;
        const document = toBookDocument(record as unknown as Record<string, unknown>);
        const version = changeVersion(record as unknown as Record<string, unknown>);
        operations.push(
          {
            index: {
              _index: target,
              _id: document.book_id,
              version,
              version_type: 'external',
            },
          },
          document,
        );

        if (operations.length >= 1_000) {
          await this.flushBulk(operations, target);
          indexed += operations.length / 2;
          operations = [];
        }
      }
      if (operations.length > 0) {
        await this.flushBulk(operations, target);
        indexed += operations.length / 2;
      }

      await this.es.refresh(target);
      // Atomic alias switch: readers never see a partially built index.
      await this.es.swapAlias(alias, target);

      this.logger.log(
        `Reindex complete: ${indexed} document(s) from MongoDB into ${target} (alias ${alias})`,
      );
      return { alias, oldIndices, newIndex: target, indexed };
    } catch (error) {
      this.logger.error(`Reindex failed: ${(error as Error).message}`);
      throw error;
    } finally {
      this.running = false;
    }
  }

  private async flushBulk(operations: Record<string, unknown>[], target: string): Promise<void> {
    const result = await this.es.bulk(operations);
    if (!result.errors) return;

    const failures = (result.items as Array<Record<string, { status: number }>>)
      .map((item) => item.index ?? item.create ?? item.update)
      .filter((item) => item && item.status >= 300);
    throw new Error(
      `Bulk indexing into ${target} failed for ${failures.length} item(s); alias not swapped`,
    );
  }
}
