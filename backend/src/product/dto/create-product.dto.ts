import { ArrayNotEmpty, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class CreateProductDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  brandId?: number

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  categoryId: number

  @ApiPropertyOptional({ example: 'PROD-001', deprecated: true })
  @IsOptional() @IsString()
  code?: string

  @ApiPropertyOptional({ example: '产品名称', deprecated: true })
  @IsOptional() @IsString()
  name?: string

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  subtitle?: string

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  baseSpec?: string

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  mainImageUrl?: string

  @ApiPropertyOptional()
  @IsOptional() @IsArray()
  images?: string[]

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  description?: string

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  deliveryText?: string

  @ApiPropertyOptional()
  @IsOptional() @IsInt()
  unitId?: number

  @ApiPropertyOptional({ description: '是否为工厂自产商品' })
  @IsOptional() @IsBoolean()
  isFactoryProduct?: boolean

  @ApiPropertyOptional({ description: '是否支持样品申请' })
  @IsOptional() @IsBoolean()
  supportSample?: boolean

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  isRecommended?: boolean

  @ApiPropertyOptional({ description: '是否在首页新品分组展示' })
  @IsOptional() @IsBoolean()
  isNew?: boolean

  @ApiPropertyOptional({ description: '是否在首页热销分组展示' })
  @IsOptional() @IsBoolean()
  isHot?: boolean
}

export class UpdateProductDto {
  @ApiPropertyOptional()
  @IsOptional() @IsInt() @Min(1)
  brandId?: number

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  name?: string

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  subtitle?: string

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  baseSpec?: string

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  mainImageUrl?: string

  @ApiPropertyOptional()
  @IsOptional() @IsArray()
  images?: string[]

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  description?: string

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  deliveryText?: string

  @ApiPropertyOptional()
  @IsOptional() @IsInt()
  categoryId?: number

  @ApiPropertyOptional()
  @IsOptional() @IsInt()
  unitId?: number

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  code?: string

  @ApiPropertyOptional({ description: '是否为工厂自产商品' })
  @IsOptional() @IsBoolean()
  isFactoryProduct?: boolean

  @ApiPropertyOptional({ description: '是否支持样品申请' })
  @IsOptional() @IsBoolean()
  supportSample?: boolean

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  isRecommended?: boolean

  @ApiPropertyOptional({ description: '是否在首页新品分组展示' })
  @IsOptional() @IsBoolean()
  isNew?: boolean

  @ApiPropertyOptional({ description: '是否在首页热销分组展示' })
  @IsOptional() @IsBoolean()
  isHot?: boolean
}

export class UpdateProductStatusDto {
  @ApiProperty({ enum: ['active', 'disabled'] })
  @IsString()
  status: string
}

export class BatchUpdateProductStatusDto {
  @ApiProperty({ type: [Number], example: [1, 2, 3] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  productIds: number[]

  @ApiProperty({ enum: ['active', 'disabled'] })
  @IsIn(['active', 'disabled'])
  status: string
}

export class BatchArchiveProductsDto {
  @ApiProperty({ type: [Number], example: [1, 2, 3] })
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  @Min(1, { each: true })
  productIds: number[]
}
