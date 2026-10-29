import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

export class CheckoutRequest {
  @ApiProperty({ example: '0f8fad5b-d9cb-469f-a165-70867728950e' })
  @IsUUID()
  holdId!: string;
}

export class WalkInCheckoutRequest {
  @ApiProperty({ example: '11111111-1111-4111-8111-111111111111' })
  @IsUUID()
  userId!: string;

  @ApiProperty({ example: 'b-demo-1' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  bookId!: string;
}
