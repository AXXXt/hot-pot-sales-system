import { IsString, IsInt, IsOptional, IsIn, Matches, MaxLength, Min } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class CreateSkuDto {
  @ApiProperty({ example: 'SKU-001' })
  @IsString()
  @Matches(/\S/)
  @MaxLength(100)
  skuCode: string

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

export class UpdateSkuDto {
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
