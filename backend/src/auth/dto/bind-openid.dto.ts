import { IsBoolean, IsOptional, IsString, Length } from 'class-validator'

export class BindOpenidDto {
  @IsString() @Length(1, 256) code: string
  @IsOptional() @IsBoolean() confirmTransfer?: boolean
}
