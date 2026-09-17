import { IsString } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class RefreshTokenDto {
  @ApiProperty({ example: 'eyJhbG...', description: '刷新令牌' })
  @IsString()
  refreshToken: string
}
