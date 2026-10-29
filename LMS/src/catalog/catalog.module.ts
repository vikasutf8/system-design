import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BookingModule } from '../booking/booking.module';
import { BooksController, CatalogAdminController, CatalogController } from './api/catalog.controller';
import { Book, BookSchema } from './domain/book.schema';
import { CatalogIndexerService } from './service/catalog-indexer.service';
import { CatalogReindexService } from './service/catalog-reindex.service';
import { CatalogService } from './service/catalog.service';

/**
 * Catalog: MongoDB source of truth + Debezium-fed Elasticsearch indexer.
 * CopyService is imported from booking because copies are PostgreSQL rows.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Book.name, schema: BookSchema }]),
    BookingModule,
  ],
  controllers: [CatalogController, BooksController, CatalogAdminController],
  providers: [CatalogService, CatalogIndexerService, CatalogReindexService],
  exports: [CatalogService],
})
export class CatalogModule {}
