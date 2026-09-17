import { Transform, type TransformFnParams } from 'class-transformer'
import { IsString, IsOptional, IsInt, IsIn, Matches, MaxLength, Min } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

function toOptionalInteger({ value }: TransformFnParams) {
  if (value === null || value === undefined) return value
  if (typeof value === 'string' && value.trim() === '') return null
  return Number(value)
}

function toOptionalDecimalString({ value }: TransformFnParams) {
  if (typeof value !== 'string') return value
  const normalized = value.trim()
  return normalized === '' ? null : normalized
}

export class CreateCustomerDto {
  @ApiProperty({ description: '客户名称' })
  @IsString() @MaxLength(120)
  customerName: string

  @ApiPropertyOptional({ description: '客户类型' })
  @IsOptional() @IsString() @MaxLength(50)
  customerType?: string

  @ApiPropertyOptional({ description: '联系人' })
  @IsOptional() @IsString() @MaxLength(100)
  contactName?: string

  @ApiPropertyOptional({ description: '联系电话' })
  @IsOptional() @IsString() @MaxLength(20)
  contactPhone?: string

  @ApiPropertyOptional({ description: '地址' })
  @IsOptional() @IsString() @MaxLength(255)
  address?: string

  @ApiPropertyOptional({ description: '客户等级ID' })
  @IsOptional() @IsInt()
  customerLevelId?: number

  @ApiPropertyOptional({ description: '销售负责人ID' })
  @IsOptional() @IsInt()
  salesOwnerId?: number
}

export class UpdateCustomerDto {
  @ApiPropertyOptional({ description: '客户名称' })
  @IsOptional() @IsString() @MaxLength(120)
  customerName?: string

  @ApiPropertyOptional({ description: '客户类型' })
  @IsOptional() @IsString() @MaxLength(50)
  customerType?: string

  @ApiPropertyOptional({ description: '联系人' })
  @IsOptional() @IsString() @MaxLength(100)
  contactName?: string

  @ApiPropertyOptional({ description: '联系电话' })
  @IsOptional() @IsString() @MaxLength(20)
  contactPhone?: string

  @ApiPropertyOptional({ description: '地址' })
  @IsOptional() @IsString() @MaxLength(255)
  address?: string

  @ApiPropertyOptional({ description: '客户等级ID' })
  @IsOptional() @IsInt()
  customerLevelId?: number | null

  @ApiPropertyOptional({ description: '销售负责人ID' })
  @IsOptional() @IsInt()
  salesOwnerId?: number | null

  @ApiPropertyOptional({ description: '状态', enum: ['active', 'disabled'] })
  @IsOptional() @IsIn(['active', 'disabled'])
  status?: 'active' | 'disabled'

  @ApiPropertyOptional({ description: '信用额度', nullable: true })
  @Transform(toOptionalDecimalString)
  @IsOptional() @IsString()
  creditLimit?: string | null

  @ApiPropertyOptional({ description: '账期天数', type: Number, nullable: true })
  @Transform(toOptionalInteger)
  @IsOptional() @IsInt() @Min(0)
  creditDays?: number | null
}

export class CreateCustomerLevelDto {
  @ApiProperty({ description: '品牌ID' })
  @IsInt()
  brandId: number

  @ApiProperty({ description: '等级名称' })
  @IsString() @MaxLength(100)
  name: string

  @ApiProperty({ description: '等级编码' })
  @IsString() @MaxLength(64)
  code: string

  @ApiPropertyOptional({ description: '折扣率' })
  @IsOptional() @IsString()
  discountRate?: string

  @ApiPropertyOptional({ description: '描述' })
  @IsOptional() @IsString() @MaxLength(255)
  description?: string
}

export class UpdateCustomerLevelDto {
  @ApiPropertyOptional({ description: '等级名称' })
  @IsOptional() @IsString() @MaxLength(100)
  name?: string

  @ApiPropertyOptional({ description: '折扣率' })
  @IsOptional() @IsString()
  discountRate?: string

  @ApiPropertyOptional({ description: '描述' })
  @IsOptional() @IsString() @MaxLength(255)
  description?: string
}

export class CreatePriceRuleDto {
  @ApiPropertyOptional({ description: '品牌ID，后端会根据 SKU 自动确定' })
  @IsOptional() @IsInt()
  brandId?: number

  @ApiProperty({ description: '客户ID' })
  @IsInt()
  customerId: number

  @ApiPropertyOptional({ description: '商品ID，后端会根据 SKU 自动确定' })
  @IsOptional() @IsInt()
  productId?: number

  @ApiProperty({ description: 'SKU ID' })
  @IsInt()
  skuId: number

  @ApiPropertyOptional({ description: '价格类型', enum: ['agreement'], default: 'agreement' })
  @IsOptional() @IsIn(['agreement'])
  priceType?: string

  @ApiProperty({ description: '协议价格' })
  @IsString() @Matches(/^\d+(?:\.\d{1,2})?$/)
  price: string
}
