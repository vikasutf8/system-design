import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/auth/auth.decorators';
import { UserRole } from '../../common/auth/roles';
import { CreateCopiesRequest } from '../../booking/api/dto/create-copies.dto';
import { CopyService } from '../../booking/service/copy.service';
import { CatalogService } from '../service/catalog.service';
import { CatalogReindexService } from '../service/catalog-reindex.service';
import { CreateBookRequest, UpdateBookRequest } from './dto/book.dto';

/** Librarian-only catalog writes (arch.md 3.3). */
@ApiTags('catalog')
@Controller('catalog/books')
export class CatalogController {
  constructor(
    private readonly catalogService: CatalogService,
    private readonly copyService: CopyService,
  ) {}

  @Post()
  @Roles(UserRole.LIBRARIAN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a book (optionally create copies)' })
  create(@Body() request: CreateBookRequest) {
    return this.catalogService.create(request);
  }

  @Put(':bookId')
  @Roles(UserRole.LIBRARIAN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Update a book' })
  update(@Param('bookId') bookId: string, @Body() request: UpdateBookRequest) {
    return this.catalogService.update(bookId, request);
  }

  @Delete(':bookId')
  @Roles(UserRole.LIBRARIAN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete a book (CDC removes it from the search index)' })
  async remove(@Param('bookId') bookId: string) {
    return this.catalogService.delete(bookId);
  }

  @Post(':bookId/copies')
  @Roles(UserRole.LIBRARIAN, UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add physical copies in PostgreSQL' })
  async addCopies(
    @Param('bookId') bookId: string,
    @Body() request: CreateCopiesRequest,
  ) {
    // Metadata and inventory are separate stores; verify the catalog entry.
    await this.catalogService.assertBookExists(bookId);
    const copyIds = await this.copyService.createCopies(bookId, request.count);
    return { bookId, created: copyIds.length, copyIds };
  }
}

/** Single-book read path. Search itself is handled by the search module. */
@ApiTags('books')
@Controller('books')
export class BooksController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get(':bookId')
  @Roles(UserRole.MEMBER, UserRole.LIBRARIAN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Book details with availability' })
  get(@Param('bookId') bookId: string) {
    return this.catalogService.getById(bookId);
  }
}

/** Admin-only index rebuild. */
@ApiTags('admin')
@Controller('admin')
export class CatalogAdminController {
  constructor(private readonly reindexService: CatalogReindexService) {}

  @Post('reindex')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rebuild the Elasticsearch books index and swap the alias' })
  reindex() {
    return this.reindexService.reindex();
  }
}
