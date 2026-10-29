import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { AvailabilityService } from '../../common/availability/availability.service';
import { LibraryConfigService } from '../../common/config/library.config';
import { ElasticsearchService } from '../../common/elasticsearch/elasticsearch.service';
import { ValidationDomainException } from '../../common/exceptions/domain.exception';
import { ServiceUnavailableException } from '../../common/exceptions/domain.exception';
import { RedisService } from '../../common/redis/redis.service';
import { SearchQueryDto } from '../api/dto/search-query.dto';

interface SearchHitMetadata {
  bookId: string;
  title: string;
  authors: string[];
  isbn: string;
  genres: string[];
  language: string | null;
  publicationYear: number | null;
}

interface SearchPayload {
  page: number;
  size: number;
  total: number;
  results: SearchHitMetadata[];
}

/**
 * Read-only search service (arch.md 3.2, LLD 7).
 *
 * Flow:
 *   1. normalized query hash -> Redis search cache (30-60 s)
 *   2. on miss: Elasticsearch multi_match / ISBN term query
 *   3. cache only metadata (never availability)
 *   4. enrich with availability from Redis, falling back to Postgres
 *
 * Paging is capped at 50 per page and 1,000 results deep.
 */
@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly es: ElasticsearchService,
    private readonly redis: RedisService,
    private readonly availability: AvailabilityService,
    private readonly config: LibraryConfigService,
  ) {}

  async search(request: SearchQueryDto) {
    const page = Math.max(0, request.page ?? 0);
    const size = Math.min(Math.max(1, request.size ?? 20), this.config.maxSearchSize);
    const from = page * size;

    if (from + size > this.config.maxSearchWindow) {
      throw new ValidationDomainException(
        `Search pagination is limited to ${this.config.maxSearchWindow} results`,
      );
    }

    const cacheKey = this.cacheKey(request, page, size);

    // 1. Metadata cache. Redis failure is transparent.
    let payload: SearchPayload | null = null;
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) payload = JSON.parse(cached) as SearchPayload;
    } catch (error) {
      this.logger.warn(`Search cache read failed: ${(error as Error).message}`);
    }

    // 2. Elasticsearch on cache miss.
    if (!payload) {
      payload = await this.queryElasticsearch(request, page, size, from);
      try {
        await this.redis.set(
          cacheKey,
          JSON.stringify(payload),
          this.config.searchCacheTtlSeconds,
        );
      } catch {
        // caching is optional
      }
    }

    // 3. Join availability after the cache, so cached metadata never hides
    //    the availability TTL.
    const counts = await this.availability.counts(payload.results.map((hit) => hit.bookId));

    return {
      page,
      size,
      total: payload.total,
      results: payload.results.map((hit) => ({
        ...hit,
        availableCopies: counts.get(hit.bookId) ?? 0,
      })),
    };
  }

  private async queryElasticsearch(
    request: SearchQueryDto,
    page: number,
    size: number,
    from: number,
  ): Promise<SearchPayload> {
    const query = this.buildQuery(request);

    try {
      await this.es.ensureBooksIndex();
      const response = await this.es.client.search({
        index: this.es.alias,
        from,
        size,
        track_total_hits: true,
        query,
      });

      const total =
        typeof response.hits.total === 'number'
          ? response.hits.total
          : (response.hits.total?.value ?? 0);

      const results: SearchHitMetadata[] = response.hits.hits.map((hit) => {
        const source = (hit._source ?? {}) as Record<string, unknown>;
        return {
          bookId: String(source.book_id ?? hit._id ?? ''),
          title: String(source.title ?? ''),
          authors: Array.isArray(source.authors) ? source.authors.map(String) : [],
          isbn: String(source.isbn ?? ''),
          genres: Array.isArray(source.genres) ? source.genres.map(String) : [],
          language: source.language ? String(source.language) : null,
          publicationYear:
            source.publication_year !== undefined && source.publication_year !== null
              ? Number(source.publication_year)
              : null,
        };
      });

      return { page, size, total, results };
    } catch (error) {
      this.logger.error(`Elasticsearch query failed: ${(error as Error).message}`);
      throw new ServiceUnavailableException('Search is temporarily unavailable');
    }
  }

  /**
   * Multi-field relevance query from LLD 7.2. An ISBN-looking query bypasses
   * full text and uses a term filter, which is fast and exact.
   */
  private buildQuery(request: SearchQueryDto): Record<string, unknown> {
    const filters: Record<string, unknown>[] = [];
    if (request.genre) filters.push({ term: { genres: request.genre } });
    if (request.lang) filters.push({ term: { language: request.lang } });

    const text = request.q?.trim() ?? '';
    const isbn = text.replace(/[-\s]/g, '');
    if (/^\d{10}$|^\d{13}$/.test(isbn)) {
      return { bool: { must: [{ term: { isbn } }], filter: filters } };
    }

    if (text.length > 0) {
      return {
        bool: {
          must: [
            {
              multi_match: {
                query: text,
                fields: ['title^3', 'authors^2', 'tags'],
                type: 'best_fields',
                fuzziness: 'AUTO',
              },
            },
          ],
          filter: filters,
        },
      };
    }

    if (filters.length > 0) {
      return { bool: { must: [{ match_all: {} }], filter: filters } };
    }
    return { match_all: {} };
  }

  /** sha256(normalized query + filters + page) -> stable cache key. */
  private cacheKey(request: SearchQueryDto, page: number, size: number): string {
    const normalized = JSON.stringify({
      q: (request.q ?? '').trim().toLowerCase(),
      genre: (request.genre ?? '').trim().toLowerCase(),
      lang: (request.lang ?? '').trim().toLowerCase(),
      page,
      size,
    });
    return `search:${createHash('sha256').update(normalized).digest('hex')}`;
  }
}
