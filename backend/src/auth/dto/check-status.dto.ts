import { IsOptional, IsString, Matches, MaxLength } from 'class-validator'

export class CheckStatusDto {
  @IsString()
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone: string

  @IsOptional() @IsString() @MaxLength(2048)
  statusTicket?: string
}
