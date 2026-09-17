import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested
} from 'class-validator'
import { Type } from 'class-transformer'
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
}

export class AdjustPriceDto {
  @ApiProperty({ description: '调整后金额' })
  @IsString()
  afterAmount: string

  @ApiProperty({ description: '调整原因' })
  @IsString() @MaxLength(255)
  reason: string
}