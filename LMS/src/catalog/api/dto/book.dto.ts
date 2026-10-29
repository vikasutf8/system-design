import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const ISBN_PATTERN = /^(?:\d{9}[\dXx]|\d{13})$/;

export class CreateBookRequest {
  @ApiPropertyOptional({ example: 'b-123', description: 'Optional external book id' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  bookId?: string;

  @ApiProperty({ example: '9781449373320' })
  @IsString()
  @Matches(ISBN_PATTERN, { message: 'isbn must be a valid ISBN-10 or ISBN-13' })
  isbn!: string;

  @ApiProperty({ example: 'Designing Data-Intensive Applications' })
  @IsString()
  @MaxLength(500)
  title!: string;

  @ApiProperty({ example: ['Martin Kleppmann'] })
  @IsArray()
  @IsString({ each: true })
  authors!: string[];

  @ApiPropertyOptional({ example: ['computing'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  genres?: string[];

  @ApiPropertyOptional({ example: 'en' })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional({ example: 2017 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3000)
  publicationYear?: number;

  @ApiPropertyOptional({ example: ['databases'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    example: 3,
    description: 'Optionally create N physical copies in PostgreSQL immediately',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  copies?: number;
}

export class UpdateBookRequest {
  @ApiPropertyOptional({ example: '9781449373321' })
  @IsOptional()
  @IsString()
  @Matches(ISBN_PATTERN, { message: 'isbn must be a valid ISBN-10 or ISBN-13' })
  isbn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  authors?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  genres?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3000)
  publicationYear?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}
