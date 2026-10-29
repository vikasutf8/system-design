import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class SearchQueryDto {
  @ApiPropertyOptional({ example: 'data intensive' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ example: 'computing' })
  @IsOptional()
  @IsString()
  genre?: string;

  @ApiPropertyOptional({ example: 'en' })
  @IsOptional()
  @IsString()
  lang?: string;

  @ApiPropertyOptional({ example: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  page: number = 0;

  @ApiPropertyOptional({ example: 20, default: 20, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  size: number = 20;
}
