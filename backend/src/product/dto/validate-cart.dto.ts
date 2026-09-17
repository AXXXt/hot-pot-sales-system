import { ArrayNotEmpty, ArrayUnique, IsArray, IsInt } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class ValidateCartDto {
  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsInt({ each: true })
  skuIds: number[]
}
