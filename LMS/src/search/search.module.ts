import { Module } from '@nestjs/common';
import { SearchController } from './api/search.controller';
import { SearchService } from './service/search.service';

/** Search service: Elasticsearch + Redis only; never writes to the catalog. */
@Module({
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
