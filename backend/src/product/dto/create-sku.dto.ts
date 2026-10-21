import { IsString, IsInt, IsOptional, IsIn, IsBoolean, IsArray, Matches, MaxLength, Min, Max } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

class SkuOptionsDto {
  @IsOptional() @IsString() @MaxLength(500) imageUrl?: string
  @IsOptional() @IsArray() packagingUnits?: Array<{ unit: string; factor: number }>
  @IsOptional() @IsInt() @Min(0) @Max(2147483647) lowStockThreshold?: number
  @IsOptional() @IsInt() @Min(1) @Max(365) leadTimeDays?: number
  @IsOptional() @IsInt() @Min(0) @Max(2147483647) safetyStock?: number
  @IsOptional() @IsBoolean() batchTracking?: boolean
}

export class CreateSkuDto extends SkuOptionsDto {
  @ApiPropertyOptional({ deprecated: true, description: '由系统自动续编，客户端传入值不参与分配' })
  @IsOptional() @IsString()
  @Matches(/\S/)
  @MaxLength(100)
  skuCode?: string

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(200)
  name?: string

  @ApiProperty({ example: '500g / 袋' })
  @IsString()
  @Matches(/\S/)
  @MaxLength(255)
  specText: string

  @ApiProperty({ example: '袋' })
  @IsString()
  @Matches(/\S/)
  @MaxLength(50)
  saleUnit: string

  @ApiProperty({ example: '88.00' })
  @IsString()
  @Matches(/^(0|[1-9]\d{0,15})(\.\d{1,2})?$/, { message: '售价必须为非负金额，最多两位小数' })
  basePrice: string

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  minOrderQty: number

  @ApiPropertyOptional()
  @IsOptional() @IsInt() @Min(0)
  stockNum?: number
}

export class UpdateSkuDto extends SkuOptionsDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(200)
  name?: string

  @ApiPropertyOptional()
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(255)
  specText?: string

  @ApiPropertyOptional()
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(50)
  saleUnit?: string

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  @Matches(/^(0|[1-9]\d{0,15})(\.\d{1,2})?$/, { message: '售价必须为非负金额，最多两位小数' })
  basePrice?: string

  @ApiPropertyOptional()
  @IsOptional() @IsInt() @Min(1)
  minOrderQty?: number

  @ApiPropertyOptional()
  @IsOptional() @IsInt() @Min(0)
  stockNum?: number
}

export class UpdateSkuStatusDto {
  @ApiProperty({ enum: ['active', 'disabled'] })
  @IsString()
  @IsIn(['active', 'disabled'])
  status: string
}
