import { IsString, IsOptional, MaxLength } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class UpdateSystemConfigDto {
  @ApiProperty({ description: '配置值' })
  @IsString()
  configValue: string

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional() @IsString() @MaxLength(255)
  remark?: string
}
