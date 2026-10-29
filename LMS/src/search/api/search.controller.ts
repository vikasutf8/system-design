import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/auth/auth.decorators';
import { UserRole } from '../../common/auth/roles';
import { SearchService } from '../service/search.service';
import { SearchQueryDto } from './dto/search-query.dto';

@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @Roles(UserRole.MEMBER, UserRole.LIBRARIAN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Search the catalog with availability enrichment' })
  search(@Query() query: SearchQueryDto) {
    return this.searchService.search(query);
  }
}
