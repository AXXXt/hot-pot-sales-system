import { IsString, IsInt, IsOptional } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class CreateCategoryDto {
  @ApiProperty({ example: 'cat-meat' })
  @IsString()
  code: string

  @ApiProperty({ example: '肉类' })
  @IsString()
  name: string

  @ApiPropertyOptional()
  @IsOptional() @IsInt()
  sortOrder?: number

  @ApiPropertyOptional()
  @IsOptional() @IsInt()
  parentId?: number
}

export class UpdateCategoryDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString()
  name?: string

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  code?: string

  @ApiPropertyOptional()
  @IsOptional() @IsInt()
  sortOrder?: number

  @ApiPropertyOptional()
  @IsOptional() @IsInt()
  parentId?: number
}
