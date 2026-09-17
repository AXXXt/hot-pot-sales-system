import { ProductVisibilityMode } from '@prisma/client'
import { ArrayUnique, IsArray, IsEnum, IsInt, IsOptional } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class UpdateProductVisibilityDto {
  @ApiProperty({ enum: ProductVisibilityMode })
  @IsEnum(ProductVisibilityMode)
  mode: ProductVisibilityMode

  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  productIds?: number[]
}
