import { IsString, IsInt, IsOptional } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class CreateSkuDto {
  @ApiProperty({ example: 'SKU-001' })
  @IsString()
  skuCode: string

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  name?: string

  @ApiProperty({ example: '500g / 袋' })
  @IsString()
  specText: string

  @ApiProperty({ example: '袋' })
  @IsString()
  saleUnit: string

  @ApiProperty({ example: '88.00' })
  @IsString()
  basePrice: string

  @ApiProperty({ example: 1 })
  @IsInt()
  minOrderQty: number

  @ApiPropertyOptional()
  @IsOptional() @IsInt()
  stockNum?: number
}

export class UpdateSkuDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString()
  name?: string

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  specText?: string

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  saleUnit?: string

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  basePrice?: string

  @ApiPropertyOptional()
  @IsOptional() @IsInt()
  minOrderQty?: number

  @ApiPropertyOptional()
  @IsOptional() @IsInt()
  stockNum?: number
}

export class UpdateSkuStatusDto {
  @ApiProperty({ enum: ['active', 'disabled'] })
  @IsString()
  status: string
}
