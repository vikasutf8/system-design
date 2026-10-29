import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

export class CreateCopiesRequest {
  @ApiProperty({ example: 3, minimum: 1, maximum: 100 })
  @IsInt()
  @Min(1)
  @Max(100)
  count!: number;
}
