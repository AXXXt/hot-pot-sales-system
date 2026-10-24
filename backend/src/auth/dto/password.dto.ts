import { IsInt, IsString, Length, Matches, Max, Min } from 'class-validator'
import { ConsentInputDto } from '../../legal/consent.dto'

export class PasswordLoginDto extends ConsentInputDto {
  @IsString() @Matches(/^1[3-9]\d{9}$/, { message: '请输入有效的手机号账号' })
  phone: string

  @IsString() @Length(1, 128, { message: '请输入登录密码，最多128个字符' })
  password: string
}

export class PasswordTokenDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/, { message: '密码设置链接无效或已过期' })
  token: string
}

export class SetPasswordDto extends PasswordTokenDto {
  @IsString() @Length(15, 128, { message: '密码须为15～128个字符，可使用长句，区分大小写' })
  @Matches(/\S/, { message: '密码不能全部为空格' })
  password: string
}

export class ChangePasswordDto {
  @IsString() @Length(1, 128)
  currentPassword: string

  @IsString() @Length(15, 128, { message: '新密码须为15～128个字符，可使用长句，区分大小写' })
  @Matches(/\S/, { message: '密码不能全部为空格' })
  password: string
}

export class PasswordSetupLinkDto {
  @IsInt() @Min(1) @Max(2147483647)
  userId: number
}
