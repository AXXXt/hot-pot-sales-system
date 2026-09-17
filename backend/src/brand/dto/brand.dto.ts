import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator'

export class CreateBrandDto {
  @ApiProperty({ example: '德品' })
  @IsString()
  @MinLength(1)
  name: string

  @ApiPropertyOptional({ example: 'DEPIN' })
  @IsOptional()
  @IsString()
  code?: string

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  logoUrl?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string
}

export class UpdateBrandDto extends PartialType(CreateBrandDto) {}
