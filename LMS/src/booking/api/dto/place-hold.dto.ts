import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class PlaceHoldRequest {
  @ApiProperty({ example: 'b-demo-1' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  bookId!: string;
}
