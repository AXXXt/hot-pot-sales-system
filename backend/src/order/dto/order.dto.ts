import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Min,
  ValidateNested,
  IsIn,
  Matches,
  IsNumber,
  Max
} from 'class-validator'
import { Transform, Type } from 'class-transformer'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

class OrderItemDto {
  @ApiProperty({ description: 'SKU ID' })
  @IsInt()
  skuId: number

  @ApiProperty({ description: '数量' })
  @IsInt()
  @Min(1)
  quantity: number
}

export class CreateOrderDto {
  @ApiProperty({ description: '客户ID' })
  @IsInt()
  customerId: number

  @ApiProperty({ description: '订单商品', type: [OrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[]

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional() @IsString() @MaxLength(500)
  remark?: string
}

export class SubmitFinanceDto {
  @ApiPropertyOptional({ description: '转账凭证对象地址' })
  @IsOptional() @IsString() @MaxLength(500)
  paymentProof?: string

  @ApiPropertyOptional({ description: '是否申请账期支付' })
  @IsOptional() @IsBoolean()
  creditRequested?: boolean

  @ApiPropertyOptional({ description: '客户当前看到的订单更新时间；用于阻止过期报价确认' })
  @IsOptional() @IsISO8601({ strict: true })
  expectedUpdatedAt?: string

  @ApiPropertyOptional({ description: '客户当前看到的应付金额' })
  @IsOptional() @IsString() @Matches(/^\d{1,16}(?:\.\d{1,2})?$/)
  expectedPayableAmount?: string
}

export class RejectFinanceDto {
  @ApiProperty({ description: '退回原因，客户可见', maxLength: 255 })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(1) @MaxLength(255)
  reason: string
}

export class AdjustPriceDto {
  @ApiProperty({ description: '调整后金额' })
  @IsString() @Matches(/^\d{1,16}(?:\.\d{1,2})?$/)
  afterAmount: string

  @ApiProperty({ description: '调整原因' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(1) @MaxLength(255)
  reason: string
}

class QuoteItemDto {
  @IsInt() @Min(1)
  skuId: number

  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(999999999999)
  quotedPrice: number
}

export class QuoteOrderDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => QuoteItemDto)
  items: QuoteItemDto[]

  @IsOptional() @IsString() @MaxLength(500)
  note?: string
}
export class CreateRefundDto {
  @ApiProperty({ description: '退款金额' })
  @IsString() @Matches(/^\d+(?:\.\d{1,2})?$/)
  amount: string

  @ApiPropertyOptional({ description: '退款方式', enum: ['transfer', 'cash', 'other'], default: 'transfer' })
  @IsOptional() @IsIn(['transfer', 'cash', 'other'])
  method?: string

  @ApiPropertyOptional({ description: '退款原因' })
  @IsOptional() @IsString() @MaxLength(255)
  reason?: string
}
