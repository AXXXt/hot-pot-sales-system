import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator'

export type ConsentChannel = 'mini' | 'buyer_web' | 'admin_web' | 'official_site'

// 可选TS字段兼容内部调用；公开登录/注册/留资入口由assertLegalConsent强制校验。
export class ConsentInputDto {
  @IsOptional() @IsBoolean()
  consentAccepted?: boolean

  @IsOptional() @IsString() @MaxLength(64)
  consentVersion?: string

  @IsOptional() @IsIn(['mini', 'buyer_web', 'admin_web', 'official_site'])
  consentChannel?: ConsentChannel
}
