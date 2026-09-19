import { IsIn, IsInt, IsOptional, IsString, IsISO8601, Matches, MaxLength } from 'class-validator'
import { Type } from 'class-transformer'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

/** 官网公开留资（无需登录） */
export class CreatePublicLeadDto {
  @ApiProperty({ description: '手机号' })
  @Matches(/^1[3-9]\d{9}$/, { message: '请输入正确的手机号' })
  phone!: string

  @ApiPropertyOptional({ description: '称呼' })
  @IsOptional() @IsString() @MaxLength(100)
  name?: string

  @ApiPropertyOptional({ description: '门店名称' })
  @IsOptional() @IsString() @MaxLength(120)
  storeName?: string

  @ApiPropertyOptional({ description: '门店规模' })
  @IsOptional() @IsString() @MaxLength(32)
  storeScale?: string

  @ApiPropertyOptional({ description: '意向商品 / 留言' })
  @IsOptional() @IsString() @MaxLength(500)
  interestedItems?: string

  /** 蜜罐字段：正常用户不可见，机器人填写后直接丢弃 */
  @ApiPropertyOptional({ description: '请勿填写' })
  @IsOptional() @IsString() @MaxLength(120)
  website?: string
}

export class UpdateLeadDto {
  @ApiPropertyOptional({ description: '线索状态', enum: ['new', 'contacted', 'converted', 'invalid'] })
  @IsOptional() @IsIn(['new', 'contacted', 'converted', 'invalid'])
  status?: 'new' | 'contacted' | 'converted' | 'invalid'

  @ApiPropertyOptional({ description: '分配跟进人用户ID' })
  @IsOptional() @Type(() => Number) @IsInt()
  assignedToId?: number

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional() @IsString() @MaxLength(500)
  remark?: string

  @ApiPropertyOptional({ description: '下次跟进时间（ISO8601）' })
  @IsOptional() @IsISO8601()
  nextFollowUpAt?: string
}

export class CreateFollowUpDto {
  @ApiProperty({ description: '跟进内容' })
  @IsString() @MaxLength(500)
  content!: string

  @ApiPropertyOptional({ description: '下次跟进时间（ISO8601）' })
  @IsOptional() @IsISO8601()
  nextFollowUpAt?: string
}
