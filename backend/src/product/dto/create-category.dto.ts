import { IsString, IsInt, IsOptional, Matches, MaxLength, Min, Max, ValidateIf } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class CreateCategoryDto {
  @ApiProperty({ example: 'cat-meat' })
  @IsString() @Matches(/\S/) @MaxLength(64)
  code: string

  @ApiProperty({ example: '肉类' })
  @IsString() @Matches(/\S/) @MaxLength(100)
  name: string

  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined) @IsInt() @Min(0) @Max(2147483647)
  sortOrder?: number

  @ApiPropertyOptional()
  @IsOptional() @IsInt() @Min(1)
  parentId?: number
}

export class UpdateCategoryDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(100)
  name?: string

  @ApiPropertyOptional()
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(64)
  code?: string

  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined) @IsInt() @Min(0) @Max(2147483647)
  sortOrder?: number

  @ApiPropertyOptional()
  @IsOptional() @IsInt() @Min(1)
  parentId?: number
}
