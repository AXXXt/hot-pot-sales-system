import { IsOptional, IsString, MaxLength } from 'class-validator'
import { LoginDto } from './login.dto'

// 使用实体 DTO，确保注册资料同手机号、验证码一起经过全局校验。
export class RegisterDto extends LoginDto {
  @IsOptional() @IsString() @MaxLength(20)
  contactName?: string

  @IsOptional() @IsString() @MaxLength(50)
  customerName?: string

  @IsOptional() @IsString() @MaxLength(50)
  province?: string

  @IsOptional() @IsString() @MaxLength(50)
  city?: string

  @IsOptional() @IsString() @MaxLength(50)
  district?: string

  @IsOptional() @IsString() @MaxLength(100)
  address?: string
}
