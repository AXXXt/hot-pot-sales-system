import { Type } from 'class-transformer'
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested
} from 'class-validator'

export class CreateAdjustmentItemDto {
  @IsInt()
  @IsNotEmpty()
  skuId: number

  @IsInt()
  @Min(1)
  quantity: number
}

export class CreateAdjustmentDto {
  @IsIn(['manual_in', 'manual_out'])
  type: 'manual_in' | 'manual_out'

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateAdjustmentItemDto)
  items: CreateAdjustmentItemDto[]
}

export class CreateStocktakeDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  remark?: string

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  skuIds?: number[]
}

export class StocktakeItemInputDto {
  @IsInt()
  @IsNotEmpty()
  skuId: number

  @IsInt()
  @Min(0)
  countedQty: number

  @IsOptional()
  @IsString()
  @MaxLength(255)
  remark?: string
}

export class UpdateStocktakeItemsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StocktakeItemInputDto)
  items: StocktakeItemInputDto[]
}

export class CompleteStocktakeDto extends UpdateStocktakeItemsDto {}