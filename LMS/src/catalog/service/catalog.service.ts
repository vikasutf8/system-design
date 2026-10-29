import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import { AvailabilityService } from '../../common/availability/availability.service';
import { LibraryConfigService } from '../../common/config/library.config';
import {
  DomainNotFoundException,
  DuplicateIsbnException,
  ValidationDomainException,
} from '../../common/exceptions/domain.exception';
import { RedisService } from '../../common/redis/redis.service';
import { CopyService } from '../../booking/service/copy.service';
import { Book, BookRecord } from '../domain/book.schema';
import { CreateBookRequest, UpdateBookRequest } from '../api/dto/book.dto';

/**
 * Owns book metadata (arch.md 3.3).
 *
 * Writes go to MongoDB only. This service never writes to Elasticsearch:
 * Debezium captures the change stream and the indexer consumer updates ES.
 * Reads of one book come from MongoDB with a 5-minute cache-aside key.
 */
@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    @InjectModel(Book.name) private readonly bookModel: Model<Book>,
    private readonly redis: RedisService,
    private readonly availability: AvailabilityService,
    private readonly copies: CopyService,
    private readonly config: LibraryConfigService,
  ) {}

  async create(request: CreateBookRequest) {
    const isbn = this.normalizeIsbn(request.isbn);
    this.assertIsbn(isbn);

    if (await this.bookModel.exists({ isbn })) {
      throw new DuplicateIsbnException(isbn);
    }

    const bookId = request.bookId?.trim() || `b-${randomUUID()}`;
    if (await this.bookModel.exists({ _id: bookId })) {
      throw new ValidationDomainException(`bookId ${bookId} already exists`);
    }

    const now = new Date();
    try {
      await this.bookModel.create({
        _id: bookId,
        isbn,
        title: request.title,
        authors: request.authors,
        genres: request.genres ?? [],
        language: request.language ?? 'en',
        publicationYear: request.publicationYear,
        tags: request.tags ?? [],
        description: request.description ?? '',
        updatedAt: now,
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new DuplicateIsbnException(isbn);
      }
      throw error;
    }

    // Copies live in PostgreSQL. If this fails the book still exists and a
    // librarian can retry POST /catalog/books/:id/copies; the two stores are
    // deliberately not in one distributed transaction (arch.md section 12).
    if (request.copies && request.copies > 0) {
      await this.copies.createCopies(bookId, request.copies);
    }

    await this.invalidate(bookId);
    return this.getById(bookId);
  }

  async update(bookId: string, request: UpdateBookRequest) {
    const book = await this.bookModel.findById(bookId);
    if (!book) {
      throw new DomainNotFoundException('BOOK_NOT_FOUND', `Book ${bookId} was not found`);
    }

    if (request.isbn) {
      const isbn = this.normalizeIsbn(request.isbn);
      this.assertIsbn(isbn);
      const duplicate = await this.bookModel.exists({ isbn, _id: { $ne: bookId } });
      if (duplicate) throw new DuplicateIsbnException(isbn);
      book.isbn = isbn;
    }

    if (request.title !== undefined) book.title = request.title;
    if (request.authors !== undefined) book.authors = request.authors;
    if (request.genres !== undefined) book.genres = request.genres;
    if (request.language !== undefined) book.language = request.language;
    if (request.publicationYear !== undefined) book.publicationYear = request.publicationYear;
    if (request.tags !== undefined) book.tags = request.tags;
    if (request.description !== undefined) book.description = request.description;
    book.updatedAt = new Date();

    await book.save();
    await this.invalidate(bookId);

    // Debezium picks this change up and the ES indexer applies it.
    return this.getById(bookId);
  }

  async delete(bookId: string): Promise<{ deleted: boolean }> {
    const deleted = await this.bookModel.findByIdAndDelete(bookId).lean();
    if (!deleted) {
      throw new DomainNotFoundException('BOOK_NOT_FOUND', `Book ${bookId} was not found`);
    }
    await this.invalidate(bookId);
    // Debezium emits a delete event; the indexer removes the ES document.
    return { deleted: true };
  }

  /** Details + live availability (GET /books/{id}). */
  async getById(bookId: string) {
    const metadata = await this.readMetadataWithCache(bookId);
    const availableCopies = await this.availability.countForBook(bookId);
    return this.toResponse(metadata, availableCopies);
  }

  /** Used before adding physical copies. */
  async assertBookExists(bookId: string): Promise<void> {
    if (!(await this.bookModel.exists({ _id: bookId }))) {
      throw new DomainNotFoundException('BOOK_NOT_FOUND', `Book ${bookId} was not found`);
    }
  }

  async readMetadataWithCache(bookId: string): Promise<BookRecord> {
    const cacheKey = `book:${bookId}`;
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as BookRecord;
    } catch {
      // Redis is optional; fall through to MongoDB.
    }

    const book = (await this.bookModel.findById(bookId).lean()) as BookRecord | null;
    if (!book) {
      throw new DomainNotFoundException('BOOK_NOT_FOUND', `Book ${bookId} was not found`);
    }

    try {
      await this.redis.set(cacheKey, JSON.stringify(book), this.config.bookCacheTtlSeconds);
    } catch {
      // ignore cache write failures
    }
    return book;
  }

  private async invalidate(bookId: string): Promise<void> {
    try {
      await this.redis.del(`book:${bookId}`);
    } catch {
      // cache TTL heals it
    }
  }

  normalizeIsbn(raw: string): string {
    return raw.replace(/[-\s]/g, '').toUpperCase();
  }

  private assertIsbn(isbn: string): void {
    if (!/^(?:\d{9}[\dX]|\d{13})$/.test(isbn)) {
      throw new ValidationDomainException('isbn must be a valid ISBN-10 or ISBN-13');
    }
  }

  private toResponse(book: BookRecord, availableCopies: number) {
    return {
      bookId: book._id,
      isbn: book.isbn,
      title: book.title,
      authors: book.authors ?? [],
      genres: book.genres ?? [],
      language: book.language,
      publicationYear: book.publicationYear ?? null,
      tags: book.tags ?? [],
      description: book.description ?? '',
      availableCopies,
    };
  }
}

