import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { IsInt, IsOptional, IsString, IsUrl, Min, MinLength, MaxLength } from 'class-validator'

export class CreateBrandDto {
  @ApiProperty({ example: '德品' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string

  @ApiPropertyOptional({ example: 'DEPIN' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @IsUrl({ protocols: ['https'], require_protocol: true })
  logoUrl?: string | null

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null
}

export class UpdateBrandDto extends PartialType(CreateBrandDto) {}
