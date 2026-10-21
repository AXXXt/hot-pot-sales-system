import { ArrayMaxSize, ArrayNotEmpty, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator'
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

  @ApiPropertyOptional({ description: '真实商品名称，沿用原副标题字段；管理标签由系统生成', maxLength: 255 })
  @IsOptional() @IsString() @Matches(/\S/, { message: '请输入商品名称' }) @MaxLength(255)
  subtitle?: string

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  baseSpec?: string

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  mainImageUrl?: string

  @ApiPropertyOptional()
  @IsOptional() @IsArray() @ArrayMaxSize(9) @IsString({ each: true }) @MaxLength(500, { each: true })
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

  @ApiPropertyOptional({ description: '真实商品名称，修改后不改变管理标签和编码', maxLength: 255 })
  @IsOptional() @IsString() @Matches(/\S/, { message: '请输入商品名称' }) @MaxLength(255)
  subtitle?: string

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  baseSpec?: string

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  mainImageUrl?: string

  @ApiPropertyOptional()
  @IsOptional() @IsArray() @ArrayMaxSize(9) @IsString({ each: true }) @MaxLength(500, { each: true })
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
